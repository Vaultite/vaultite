// A trackpad's pinch over a Browser page while the window's own page is raised over it (electron/web.ts `raise`): macOS
// gives it to the view on top, the window's page, which can't pass it on as it does the pointer (no API takes a pinch).
// So it's handed to the page under it here, the gesture whole, before the window sees it. One call, JSON in and out;
// on the main thread (the Electron main process's JS is).
#import <AppKit/AppKit.h>

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

// ---------- The pinch

/** The windows (their numbers) whose page lets the pointer through to a page where it is now. */
static NSMutableSet<NSNumber *> *passing;
/** Where the pinch going on goes: chosen as it begins, so it stays one gesture. */
static __weak NSView *target;
static id monitor;

/** The page under the window's view at `at`: the topmost of the window's views under the one on top there (the
 *  window's page, raised), if it's a page (Chromium's view), else nil. */
static NSView *pageUnder(NSWindow *w, NSPoint at) {
  NSView *content = w.contentView, *top = [content hitTest:[content.superview convertPoint:at fromView:nil]];
  while (top && top.superview != content) top = top.superview;
  NSArray<NSView *> *views = content.subviews;
  NSUInteger i = top ? [views indexOfObject:top] : NSNotFound;
  if (i == NSNotFound) return nil;
  while (i-- > 0) {
    NSView *v = views[i];
    if (v.hidden || !NSPointInRect([v convertPoint:at fromView:nil], v.bounds)) continue;
    NSView *hit = [v hitTest:[v.superview convertPoint:at fromView:nil]];
    return [hit isKindOfClass:NSClassFromString(@"RenderWidgetHostViewCocoa")] ? hit : nil;
  }
  return nil;
}

static void watch(void) {
  if (monitor) return;
  monitor = [NSEvent addLocalMonitorForEventsMatchingMask:NSEventMaskMagnify handler:^NSEvent *(NSEvent *e) {
    if (e.phase == NSEventPhaseBegan || e.phase == NSEventPhaseNone)
      target = e.window && [passing containsObject:@(e.window.windowNumber)] ? pageUnder(e.window, e.locationInWindow) : nil;
    NSView *to = target;
    if (e.phase & (NSEventPhaseEnded | NSEventPhaseCancelled)) target = nil;
    if (!to || to.window != e.window) return e;
    // (as macOS would have given it to the page: Chromium's own threshold, phases and anchor under the fingers)
    [to magnifyWithEvent:e];
    return nil;
  }];
}

// ---------- The one call

static NSDictionary *handle(NSDictionary *in) {
  NSString *cmd = in[@"cmd"];
  if ([cmd isEqual:@"pass"]) {
    if (![in[@"window"] isKindOfClass:NSNumber.class]) return @{ @"error": @"pass needs a window (its number)" };
    passing = passing ?: [NSMutableSet set];
    if ([in[@"on"] boolValue]) [passing addObject:in[@"window"]];
    else [passing removeObject:in[@"window"]];
    watch();
    return @{ @"passing": @(passing.count) };
  }
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
