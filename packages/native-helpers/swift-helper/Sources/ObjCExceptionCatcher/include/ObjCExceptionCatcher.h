#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Information about a caught NSException
@interface ObjCExceptionInfo : NSObject
@property (nonatomic, readonly) NSString *name;
@property (nonatomic, readonly) NSString *reason;
@property (nonatomic, readonly, nullable) NSArray<NSString *> *callStackSymbols;
@end

/// Catches Objective-C NSExceptions and converts them to Swift-friendly errors
@interface ObjCExceptionCatcher : NSObject

/// Executes a block and catches any NSException
/// Returns the block result on success, or nil + exception info on failure
+ (nullable id)catchException:(id _Nullable (^)(void))block
                exceptionInfo:(ObjCExceptionInfo * _Nullable * _Nullable)exceptionInfo;

@end

NS_ASSUME_NONNULL_END
