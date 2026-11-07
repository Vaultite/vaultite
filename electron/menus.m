// The menu bar menu's section headers (Electron's `type: "header"`, helper.ts: Companion, Jobs) as bold titles: AppKit
// draws them small and semibold, and Electron takes no font. Set as each menu opens, on the items it just built. One
// call, JSON in and out; on the main thread (the Electron main process's JS is).
#import <AppKit/AppKit.h>
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

// ---------- The headers

static id observer;

/** Its section headers' titles in bold at the menu's size (still in the secondary color AppKit gives a header). */
static void boldHeaders(NSMenu *menu) {
  if (@available(macOS 14, *)) {
    for (NSMenuItem *item in menu.itemArray) {
      if (!item.isSectionHeader || item.attributedTitle) continue;
      item.attributedTitle = [[NSAttributedString alloc] initWithString:item.title
        attributes:@{ NSFontAttributeName: [NSFont boldSystemFontOfSize:NSFont.systemFontSize] }];
    }
  }
}

// ---------- The one call

static NSDictionary *handle(NSDictionary *in) {
  NSString *cmd = in[@"cmd"];
  if ([cmd isEqual:@"boldHeaders"]) {
    observer = observer ?: [NSNotificationCenter.defaultCenter addObserverForName:NSMenuDidBeginTrackingNotification object:nil
      queue:nil usingBlock:^(NSNotification *n) { if ([n.object isKindOfClass:NSMenu.class]) boldHeaders(n.object); }];
    return @{ @"on": @YES };
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
