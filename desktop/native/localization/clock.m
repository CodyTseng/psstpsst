#import <Foundation/Foundation.h>
#include <stdio.h>

int main(void) {
  @autoreleasepool {
    // The localized hour template incorporates the user's 12/24-hour override.
    NSString *pattern = [NSDateFormatter dateFormatFromTemplate:@"j"
                                                      options:0
                                                       locale:NSLocale.autoupdatingCurrentLocale];
    if (pattern.length == 0) {
      puts("unknown");
    } else {
      puts([pattern containsString:@"a"] ? "12h" : "24h");
    }
  }
  return 0;
}
