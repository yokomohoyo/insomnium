// SPIKE ONLY (spike/mas-sandbox, never merge).
// Print which application LaunchServices would open a URL scheme with.
//   lshandler [scheme]   (default: insomnia)
#import <AppKit/AppKit.h>
#import <CoreServices/CoreServices.h>
#import <Foundation/Foundation.h>

int main(int argc, const char **argv) {
  @autoreleasepool {
    NSString *scheme = argc > 1 ? @(argv[1]) : @"insomnia";
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
    CFStringRef def = LSCopyDefaultHandlerForURLScheme((__bridge CFStringRef)scheme);
    CFArrayRef all = LSCopyAllHandlersForURLScheme((__bridge CFStringRef)scheme);
#pragma clang diagnostic pop
    printf("LSCopyDefaultHandlerForURLScheme(%s) = %s\n", scheme.UTF8String,
           def ? [(__bridge NSString *)def UTF8String] : "(null)");
    printf("LSCopyAllHandlersForURLScheme(%s) = %s\n", scheme.UTF8String,
           all ? [[(__bridge NSArray *)all componentsJoinedByString:@","] UTF8String] : "(null)");
    NSURL *url = [NSURL URLWithString:[NSString stringWithFormat:@"%@://app/probe", scheme]];
    NSURL *app = [[NSWorkspace sharedWorkspace] URLForApplicationToOpenURL:url];
    printf("NSWorkspace.URLForApplicationToOpenURL = %s\n", app ? app.path.UTF8String : "(null)");
    if (@available(macOS 12.0, *)) {
      for (NSURL *a in [[NSWorkspace sharedWorkspace] URLsForApplicationsToOpenURL:url]) {
        printf("NSWorkspace.URLsForApplicationsToOpenURL[] = %s\n", a.path.UTF8String);
      }
    }
    if (def) CFRelease(def);
    if (all) CFRelease(all);
  }
  return 0;
}
