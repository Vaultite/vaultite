// macOS permissions in the app's own process, as a Node addon (electron/permissions.ts): Location and Input monitoring
// answer only the process that asks (a helper would be asking for itself), and the drag panel is one of the app's windows.
// One call, JSON in and out; it must run on the main thread (the Electron main process's JS does).
#import <AppKit/AppKit.h>
#import <CoreLocation/CoreLocation.h>
#import <IOKit/hidsystem/IOHIDLib.h>

// ---------- Node-API: the few calls used, declared (the host exports them), so building needs no headers

typedef struct napi_env__ *napi_env;
typedef struct napi_value__ *napi_value;
typedef struct napi_callback_info__ *napi_callback_info;
typedef int napi_status;
typedef napi_value (*napi_callback)(napi_env, napi_callback_info);
extern napi_status napi_get_cb_info(napi_env, napi_callback_info, size_t *, napi_value *, napi_value *, void **);
extern napi_status napi_get_value_string_utf8(napi_env, napi_value, char *, size_t, size_t *);
extern napi_status napi_create_string_utf8(napi_env, const char *, size_t, napi_value *);
extern napi_status napi_create_function(napi_env, const char *, size_t, napi_callback, void *, napi_value *);
extern napi_status napi_set_named_property(napi_env, napi_value, const char *, napi_value);

static NSString *const SETTINGS = @"com.apple.systempreferences";

static NSDictionary *rectJSON(NSRect r) { return @{ @"x": @(r.origin.x), @"y": @(r.origin.y), @"width": @(r.size.width), @"height": @(r.size.height) }; }
static NSRect rectOf(id d) {
  if (![d isKindOfClass:NSDictionary.class]) return NSZeroRect;
  return NSMakeRect([d[@"x"] doubleValue], [d[@"y"] doubleValue], [d[@"width"] doubleValue], [d[@"height"] doubleValue]);
}

// ---------- Location: CoreLocation's answer for this app, and its prompt

static CLLocationManager *locator;
static BOOL updating;

static NSString *locationState(void) {
  if (!locator) locator = [CLLocationManager new];
  CLAuthorizationStatus s = locator.authorizationStatus;
  if (s != kCLAuthorizationStatusNotDetermined && updating) { [locator stopUpdatingLocation]; updating = NO; }
  return s == kCLAuthorizationStatusNotDetermined ? @"not-asked"
    : s == kCLAuthorizationStatusDenied || s == kCLAuthorizationStatusRestricted ? @"denied" : @"allowed";
}

/** macOS's prompt (only while not asked: after, only System Settings changes it). Before macOS 15 a start asks. */
static void askLocation(void) {
  if (![locationState() isEqual:@"not-asked"]) return;
  if (@available(macOS 15, *)) [locator requestWhenInUseAuthorization];
  else { updating = YES; [locator startUpdatingLocation]; }
}

static NSString *inputState(void) {
  IOHIDAccessType t = IOHIDCheckAccess(kIOHIDRequestTypeListenEvent);
  return t == kIOHIDAccessTypeGranted ? @"allowed" : t == kIOHIDAccessTypeDenied ? @"denied" : @"not-asked";
}

// ---------- System Settings' window, from the window server (bounds and owner need no permission)

/** Its largest window on screen, in AppKit's coordinates (bottom-left origin), or NSZeroRect. */
static NSRect settingsFrame(void) {
  NSMutableSet *pids = [NSMutableSet set];
  for (NSRunningApplication *a in [NSRunningApplication runningApplicationsWithBundleIdentifier:SETTINGS]) [pids addObject:@(a.processIdentifier)];
  if (!pids.count) return NSZeroRect;
  NSArray *list = CFBridgingRelease(CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly | kCGWindowListExcludeDesktopElements, kCGNullWindowID));
  CGRect best = CGRectZero;
  for (NSDictionary *w in list) {
    if (![pids containsObject:w[(id)kCGWindowOwnerPID]] || [w[(id)kCGWindowLayer] intValue] != 0 || [w[(id)kCGWindowAlpha] doubleValue] <= 0) continue;
    CGRect r;
    if (!CGRectMakeWithDictionaryRepresentation((__bridge CFDictionaryRef)w[(id)kCGWindowBounds], &r) || r.size.width <= 320 || r.size.height <= 240) continue;
    if (r.size.width * r.size.height > best.size.width * best.size.height) best = r;
  }
  if (CGRectIsEmpty(best) || !NSScreen.screens.count) return NSZeroRect;
  // (the window server's origin is the main screen's top-left)
  CGFloat top = NSScreen.screens[0].frame.size.height;
  return NSMakeRect(best.origin.x, top - best.origin.y - best.size.height, best.size.width, best.size.height);
}

static NSRect visibleFrameFor(NSRect r) {
  NSScreen *best = NSScreen.mainScreen; CGFloat most = 0;
  for (NSScreen *s in NSScreen.screens) {
    NSRect i = NSIntersectionRect(s.frame, r);
    if (i.size.width * i.size.height > most) { most = i.size.width * i.size.height; best = s; }
  }
  return best ? best.visibleFrame : r;
}

/** Where the panel goes: just under the window, centred under its content (right of the sidebar, where the list is);
 *  inside its bottom edge when there's no room below. Kept on the screen. */
static NSRect place(NSRect settings, NSRect visible, NSSize size) {
  CGFloat sidebar = MIN(215, settings.size.width * 0.3), gap = 10;
  CGFloat x = settings.origin.x + sidebar + (settings.size.width - sidebar - size.width) / 2;
  CGFloat y = settings.origin.y - size.height - gap;
  if (y < visible.origin.y + gap) y = settings.origin.y + gap * 2;
  x = MAX(visible.origin.x + gap, MIN(x, NSMaxX(visible) - size.width - gap));
  y = MAX(visible.origin.y + gap, MIN(y, NSMaxY(visible) - size.height - gap));
  return NSMakeRect(round(x), round(y), size.width, size.height);
}

// ---------- The drag panel: the app's icon and name, dragged into System Settings' list as the app's bundle

@interface VTButton : NSButton
@end
@implementation VTButton
- (BOOL)acceptsFirstMouse:(NSEvent *)e { return YES; }
@end

@interface VTChip : NSView <NSDraggingSource>
@property(strong) NSURL *app;
@property(strong) NSEvent *down;
@property BOOL dragging;
@end

@implementation VTChip
- (BOOL)acceptsFirstMouse:(NSEvent *)e { return YES; }
- (BOOL)isFlipped { return NO; }
- (void)drawRect:(NSRect)dirty {
  NSBezierPath *p = [NSBezierPath bezierPathWithRoundedRect:NSInsetRect(self.bounds, 0.5, 0.5) xRadius:8 yRadius:8];
  [[NSColor.labelColor colorWithAlphaComponent:0.07] setFill]; [p fill];
  [[NSColor.labelColor colorWithAlphaComponent:0.12] setStroke]; [p stroke];
}
- (void)updateTrackingAreas {
  for (NSTrackingArea *t in self.trackingAreas) [self removeTrackingArea:t];
  // (the app isn't active while System Settings is: only an always-active area changes the cursor)
  [self addTrackingArea:[[NSTrackingArea alloc] initWithRect:self.bounds options:NSTrackingCursorUpdate | NSTrackingActiveAlways | NSTrackingInVisibleRect owner:self userInfo:nil]];
  [super updateTrackingAreas];
}
- (void)cursorUpdate:(NSEvent *)e { [(self.dragging ? NSCursor.closedHandCursor : NSCursor.openHandCursor) set]; }
- (void)mouseDown:(NSEvent *)e { self.down = e; [NSCursor.closedHandCursor set]; }
- (void)mouseUp:(NSEvent *)e { self.down = nil; [NSCursor.openHandCursor set]; }
- (void)mouseDragged:(NSEvent *)e {
  if (!self.down || self.dragging) return;
  NSPoint a = self.down.locationInWindow, b = e.locationInWindow;
  if (hypot(a.x - b.x, a.y - b.y) < 3) return;
  self.dragging = YES;
  NSBitmapImageRep *rep = [self bitmapImageRepForCachingDisplayInRect:self.bounds];
  [self cacheDisplayInRect:self.bounds toBitmapImageRep:rep];
  NSImage *image = [[NSImage alloc] initWithSize:self.bounds.size];
  [image addRepresentation:rep];
  NSDraggingItem *item = [[NSDraggingItem alloc] initWithPasteboardWriter:self.app];
  [item setDraggingFrame:self.bounds contents:image];
  NSDraggingSession *s = [self beginDraggingSessionWithItems:@[item] event:self.down source:self];
  s.animatesToStartingPositionsOnCancelOrFail = YES;
}
- (NSDragOperation)draggingSession:(NSDraggingSession *)s sourceOperationMaskForDraggingContext:(NSDraggingContext)c { return NSDragOperationCopy; }
- (void)draggingSession:(NSDraggingSession *)s endedAtPoint:(NSPoint)p operation:(NSDragOperation)op { self.dragging = NO; self.down = nil; }
@end

@interface VTPanel : NSPanel
@end
@implementation VTPanel
- (BOOL)canBecomeKeyWindow { return NO; }
- (BOOL)canBecomeMainWindow { return NO; }
@end

static VTPanel *panel;
static VTChip *chip;
static NSTimer *ticker;
static NSDate *opened;
static BOOL seen;
static int missing;
/** Why the last panel closed ("" while it's open): granted (the app's call), user, settings (it closed), timeout. */
static NSString *closedWhy = @"";
static const NSSize SIZE = { 288, 88 };

static void closePanel(NSString *why) {
  [ticker invalidate]; ticker = nil;
  [panel orderOut:nil]; panel = nil; chip = nil;
  closedWhy = why;
}

static void tick(void) {
  if (!panel) return;
  NSRect s = settingsFrame();
  BOOL found = !NSIsEmptyRect(s);
  if (found) { seen = YES; missing = 0; } else missing++;
  // (a moment without its window is a pane changing; 2 s is it closed. Never seen in 20 s: it didn't open)
  if (seen && missing > 40) { closePanel(@"settings"); return; }
  if (!seen && -opened.timeIntervalSinceNow > 20) { closePanel(@"timeout"); return; }
  BOOL front = [NSWorkspace.sharedWorkspace.frontmostApplication.bundleIdentifier isEqual:SETTINGS] || chip.dragging;
  if (found && front) {
    [panel setFrame:place(s, visibleFrameFor(s), SIZE) display:YES];
    if (!panel.visible) [panel orderFrontRegardless];
  } else if (panel.visible && !chip.dragging) [panel orderOut:nil];
}

static NSTextField *label(NSString *text, NSFont *font, NSColor *color, NSRect frame) {
  NSTextField *l = [NSTextField labelWithString:text];
  l.font = font; l.textColor = color; l.frame = frame; l.lineBreakMode = NSLineBreakByTruncatingTail;
  return l;
}

@interface VTCloser : NSObject
@end
@implementation VTCloser
+ (void)close:(id)sender { closePanel(@"user"); }
@end

static void showPanel(NSString *appPath, NSString *name, NSString *hint) {
  if (panel) closePanel(@"replaced");
  panel = [[VTPanel alloc] initWithContentRect:NSMakeRect(0, 0, SIZE.width, SIZE.height)
    styleMask:NSWindowStyleMaskBorderless | NSWindowStyleMaskNonactivatingPanel backing:NSBackingStoreBuffered defer:NO];
  panel.floatingPanel = YES;
  panel.level = NSFloatingWindowLevel;
  panel.collectionBehavior = NSWindowCollectionBehaviorCanJoinAllSpaces | NSWindowCollectionBehaviorFullScreenAuxiliary | NSWindowCollectionBehaviorIgnoresCycle;
  panel.opaque = NO;
  panel.backgroundColor = NSColor.clearColor;
  panel.hasShadow = YES;
  panel.hidesOnDeactivate = NO;
  panel.releasedWhenClosed = NO;
  panel.excludedFromWindowsMenu = YES;
  panel.becomesKeyOnlyIfNeeded = YES;

  NSVisualEffectView *bg = [[NSVisualEffectView alloc] initWithFrame:NSMakeRect(0, 0, SIZE.width, SIZE.height)];
  bg.material = NSVisualEffectMaterialPopover;
  bg.blendingMode = NSVisualEffectBlendingModeBehindWindow;
  bg.state = NSVisualEffectStateActive;
  NSImage *mask = [NSImage imageWithSize:NSMakeSize(29, 29) flipped:NO drawingHandler:^BOOL(NSRect r) {
    [[NSBezierPath bezierPathWithRoundedRect:r xRadius:14 yRadius:14] fill]; return YES;
  }];
  mask.capInsets = NSEdgeInsetsMake(14, 14, 14, 14);
  mask.resizingMode = NSImageResizingModeStretch;
  bg.maskImage = mask;
  panel.contentView = bg;

  [bg addSubview:label(hint, [NSFont systemFontOfSize:12 weight:NSFontWeightMedium], NSColor.secondaryLabelColor, NSMakeRect(14, 60, SIZE.width - 50, 16))];
  VTButton *close = [VTButton buttonWithImage:[NSImage imageWithSystemSymbolName:@"xmark.circle.fill" accessibilityDescription:@"Close"] target:VTCloser.class action:@selector(close:)];
  close.bordered = NO;
  close.contentTintColor = NSColor.tertiaryLabelColor;
  close.frame = NSMakeRect(SIZE.width - 30, 58, 20, 20);
  [bg addSubview:close];

  chip = [[VTChip alloc] initWithFrame:NSMakeRect(10, 10, SIZE.width - 20, 42)];
  chip.app = [NSURL fileURLWithPath:appPath];
  NSImage *icon = [NSWorkspace.sharedWorkspace iconForFile:appPath];
  icon.size = NSMakeSize(28, 28);
  NSImageView *iv = [NSImageView imageViewWithImage:icon];
  iv.frame = NSMakeRect(8, 7, 28, 28);
  [chip addSubview:iv];
  [chip addSubview:label(name, [NSFont systemFontOfSize:13 weight:NSFontWeightSemibold], NSColor.labelColor, NSMakeRect(44, 12, SIZE.width - 72, 18))];
  [bg addSubview:chip];

  opened = [NSDate date]; seen = NO; missing = 0; closedWhy = @"";
  ticker = [NSTimer timerWithTimeInterval:0.05 repeats:YES block:^(NSTimer *t) { tick(); }];
  // (common modes: it follows the window while a drag or a menu runs the loop too)
  [NSRunLoop.mainRunLoop addTimer:ticker forMode:NSRunLoopCommonModes];
  tick();
}

// ---------- The one call

static NSDictionary *handle(NSDictionary *in) {
  NSString *cmd = in[@"cmd"];
  if ([cmd isEqual:@"location"]) return @{ @"state": locationState() };
  if ([cmd isEqual:@"ask-location"]) { askLocation(); return @{ @"state": locationState() }; }
  if ([cmd isEqual:@"input"]) return @{ @"state": inputState() };
  if ([cmd isEqual:@"show"]) { showPanel(in[@"app"], in[@"name"], in[@"hint"]); return @{ @"ok": @YES }; }
  if ([cmd isEqual:@"hide"]) { if (panel) closePanel(in[@"why"] ?: @"granted"); return @{ @"ok": @YES }; }
  if ([cmd isEqual:@"panel"]) return @{ @"open": panel ? @YES : @NO, @"why": closedWhy };
  if ([cmd isEqual:@"frame"]) { NSRect r = settingsFrame(); return @{ @"settings": NSIsEmptyRect(r) ? NSNull.null : rectJSON(r) }; }
  if ([cmd isEqual:@"place"]) return rectJSON(place(rectOf(in[@"settings"]), rectOf(in[@"visible"]), SIZE));
  return @{ @"error": [NSString stringWithFormat:@"no command '%@'", cmd] };
}

static napi_value call(napi_env env, napi_callback_info info) {
  size_t argc = 1, len = 0;
  napi_value arg = NULL, out = NULL;
  napi_get_cb_info(env, info, &argc, &arg, NULL, NULL);
  NSDictionary *res;
  if (argc < 1 || napi_get_value_string_utf8(env, arg, NULL, 0, &len) != 0) res = @{ @"error": @"a JSON string" };
  else {
    NSMutableData *buf = [NSMutableData dataWithLength:len + 1];
    napi_get_value_string_utf8(env, arg, buf.mutableBytes, len + 1, &len);
    id in = [NSJSONSerialization JSONObjectWithData:[buf subdataWithRange:NSMakeRange(0, len)] options:0 error:nil];
    @try { res = [in isKindOfClass:NSDictionary.class] ? handle(in) : @{ @"error": @"a JSON object" }; }
    @catch (NSException *e) { res = @{ @"error": e.reason ?: e.name }; }
  }
  NSData *json = [NSJSONSerialization dataWithJSONObject:res options:0 error:nil];
  napi_create_string_utf8(env, json.bytes, json.length, &out);
  return out;
}

__attribute__((visibility("default"))) napi_value napi_register_module_v1(napi_env env, napi_value exports) {
  napi_value fn;
  napi_create_function(env, "call", 4, call, NULL, &fn);
  napi_set_named_property(env, exports, "call", fn);
  return exports;
}
