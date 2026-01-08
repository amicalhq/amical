#import "ObjCExceptionCatcher.h"

@interface ObjCExceptionInfo ()
@property (nonatomic, readwrite) NSString *name;
@property (nonatomic, readwrite) NSString *reason;
@property (nonatomic, readwrite, nullable) NSArray<NSString *> *callStackSymbols;
@end

@implementation ObjCExceptionInfo
@end

@implementation ObjCExceptionCatcher

+ (nullable id)catchException:(id _Nullable (^)(void))block
                exceptionInfo:(ObjCExceptionInfo * _Nullable * _Nullable)exceptionInfo {
    @try {
        return block();
    }
    @catch (NSException *exception) {
        NSLog(@"[ObjCExceptionCatcher] Caught NSException: %@ - %@",
              exception.name, exception.reason);

        if (exceptionInfo) {
            ObjCExceptionInfo *info = [[ObjCExceptionInfo alloc] init];
            info.name = exception.name ?: @"Unknown";
            info.reason = exception.reason ?: @"Unknown reason";
            info.callStackSymbols = exception.callStackSymbols;
            *exceptionInfo = info;
        }
        return nil;
    }
}

@end
