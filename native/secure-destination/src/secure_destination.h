#ifndef SECURE_DESTINATION_H
#define SECURE_DESTINATION_H

#include <napi.h>
#include <string>

// renameat2 flags — defined in linux/fs.h but included here for portability
#ifndef RENAME_NOREPLACE
#define RENAME_NOREPLACE (1 << 0)
#endif

namespace secure_destination {

// Resolve flags for openat2
#ifndef RESOLVE_BENEATH
#define RESOLVE_BENEATH 0x40
#endif

#ifndef RESOLVE_NO_SYMLINKS
#define RESOLVE_NO_SYMLINKS 0x20
#endif

struct OpenAt2Result {
  int fd;
  int errcode;
  std::string error_msg;
};

struct SecureDestResult {
  bool success;
  int errcode;
  std::string error_msg;
  int fd;
};

// Probe the platform for required capabilities
Napi::Value ProbeCapability(const Napi::CallbackInfo& info);

// Acquire a trusted root descriptor with openat2
Napi::Value AcquireTrustedRoot(const Napi::CallbackInfo& info);

// Open a path relative to a trusted root (descriptor-relative)
Napi::Value OpenRelative(const Napi::CallbackInfo& info);

// Create one directory component relative to a held descriptor
Napi::Value MkdirRelative(const Napi::CallbackInfo& info);

// Remove one file component relative to a held descriptor
Napi::Value UnlinkRelative(const Napi::CallbackInfo& info);

// Remove one directory component relative to a held descriptor
Napi::Value RmdirRelative(const Napi::CallbackInfo& info);

// Create a temporary file relative to a trusted root
Napi::Value CreateTempRelative(const Napi::CallbackInfo& info);

// Atomic rename by descriptor-relative path
Napi::Value AtomicRename(const Napi::CallbackInfo& info);

// Lock a file by path
Napi::Value LockFile(const Napi::CallbackInfo& info);

// Unlock a file by path
Napi::Value UnlockFile(const Napi::CallbackInfo& info);

// Close a descriptor
Napi::Value CloseFd(const Napi::CallbackInfo& info);

// Export constants
Napi::Value GetResolveBeneath(const Napi::CallbackInfo& info);
Napi::Value GetResolveNoSymlinks(const Napi::CallbackInfo& info);
Napi::Value GetRenameNoReplace(const Napi::CallbackInfo& info);

}  // namespace secure_destination

#endif  // SECURE_DESTINATION_H
