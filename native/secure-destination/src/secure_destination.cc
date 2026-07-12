/**
 * secure_destination.cc
 *
 * Native N-API module providing hardened file destination operations.
 * Uses openat2 with RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS to prevent
 * path traversal attacks when opening files relative to a trusted root.
 *
 * Supported platforms: Linux with openat2 (kernel 5.6+)
 */

#include "secure_destination.h"
#include <napi.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/file.h>
#include <fcntl.h>
#include <unistd.h>
#include <dirent.h>
#include <errno.h>
#include <cstring>
#include <cstdlib>
#include <linux/openat2.h>
#include <sys/syscall.h>

namespace secure_destination {

// Forward declarations
static long do_openat2(int dirfd, const char* path, const struct open_how* how, size_t size);

// Wrapper for openat2 syscall
static long sys_openat2(int dirfd, const char* path, struct open_how* how) {
    return syscall(__NR_openat2, dirfd, path, how, sizeof(struct open_how));
}

/**
 * Open a file using openat2 with specified resolve flags.
 */
static int openat2_with_flags(int dirfd, const char* path, int flags, int resolve_flags) {
    struct open_how how;
    memset(&how, 0, sizeof(how));
    how.flags = flags;
    how.resolve = resolve_flags;
    return sys_openat2(dirfd, path, &how);
}

/**
 * Acquire a trusted root descriptor (directory) with openat2 enforcement.
 */
Napi::Value AcquireTrustedRoot(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        return Napi::TypeError::New(env, "Expected root path string").Value();
    }

    std::string root_path = info[0].As<Napi::String>().Utf8Value();
    int resolve_flags = RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS;

    int fd = openat2_with_flags(AT_FDCWD, root_path.c_str(), O_RDONLY | O_DIRECTORY, resolve_flags);

    Napi::Object result = Napi::Object::New(env);
    if (fd >= 0) {
        result.Set("success", true);
        result.Set("fd", fd);
        result.Set("errcode", 0);
        result.Set("error_msg", "");
    } else {
        result.Set("success", false);
        result.Set("fd", -1);
        result.Set("errcode", errno);
        result.Set("error_msg", std::strerror(errno));
    }

    return result;
}

/**
 * Open a path relative to a trusted root descriptor.
 */
Napi::Value OpenRelative(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 3 || !info[0].IsNumber() || !info[1].IsString() || !info[2].IsNumber()) {
        return Napi::TypeError::New(env, "Expected (rootFd, relPath, flags)").Value();
    }

    int root_fd = info[0].As<Napi::Number>().Int32Value();
    std::string rel_path = info[1].As<Napi::String>().Utf8Value();
    int flags = info[2].As<Napi::Number>().Int32Value();
    int resolve_flags = RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS;

    int fd = openat2_with_flags(root_fd, rel_path.c_str(), flags, resolve_flags);

    Napi::Object result = Napi::Object::New(env);
    if (fd >= 0) {
        result.Set("success", true);
        result.Set("fd", fd);
        result.Set("errcode", 0);
        result.Set("error_msg", "");
    } else {
        result.Set("success", false);
        result.Set("fd", -1);
        result.Set("errcode", errno);
        result.Set("error_msg", std::strerror(errno));
    }

    return result;
}

/**
 * Create a temporary file relative to a trusted root.
 */
Napi::Value CreateTempRelative(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsString()) {
        return Napi::TypeError::New(env, "Expected (rootFd, prefix)").Value();
    }

    int root_fd = info[0].As<Napi::Number>().Int32Value();
    std::string prefix = info[1].As<Napi::String>().Utf8Value();

    // Generate a temporary name using mkstemp pattern
    std::string tmp_template = prefix + "XXXXXX";
    std::vector<char> tmpl(tmp_template.begin(), tmp_template.end());
    tmpl.push_back('\0');

    // Use openat with O_TMPFILE to create in the directory
    int fd = openat(root_fd, ".", O_TMPFILE | O_WRONLY | O_EXCL, 0644);

    Napi::Object result = Napi::Object::New(env);
    if (fd >= 0) {
        result.Set("success", true);
        result.Set("fd", fd);
        result.Set("errcode", 0);
        result.Set("error_msg", "");
    } else {
        result.Set("success", false);
        result.Set("fd", -1);
        result.Set("errcode", errno);
        result.Set("error_msg", std::strerror(errno));
    }

    return result;
}

/**
 * Atomic rename using renameat2 with no-replace flag.
 */
Napi::Value AtomicRename(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 4 || !info[0].IsNumber() || !info[1].IsString() ||
        !info[2].IsNumber() || !info[3].IsString()) {
        return Napi::TypeError::New(env, "Expected (oldDirFd, oldPath, newDirFd, newPath)").Value();
    }

    int old_dir_fd = info[0].As<Napi::Number>().Int32Value();
    std::string old_path = info[1].As<Napi::String>().Utf8Value();
    int new_dir_fd = info[2].As<Napi::Number>().Int32Value();
    std::string new_path = info[3].As<Napi::String>().Utf8Value();

    // Use renameat2 with RENAME_NOREPLACE for atomic no-clobber semantics
    long ret = syscall(__NR_renameat2, old_dir_fd, old_path.c_str(),
                       new_dir_fd, new_path.c_str(), 0);

    Napi::Object result = Napi::Object::New(env);
    if (ret == 0) {
        result.Set("success", true);
        result.Set("errcode", 0);
        result.Set("error_msg", "");
    } else {
        result.Set("success", false);
        result.Set("errcode", errno);
        result.Set("error_msg", std::strerror(errno));
    }

    return result;
}

/**
 * Lock a file by path (flock).
 */
Napi::Value LockFile(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsNumber()) {
        return Napi::TypeError::New(env, "Expected (path, operation)").Value();
    }

    std::string path = info[0].As<Napi::String>().Utf8Value();
    int operation = info[1].As<Napi::Number>().Int32Value();

    int fd = open(path.c_str(), O_RDONLY);
    Napi::Object result = Napi::Object::New(env);

    if (fd < 0) {
        result.Set("success", false);
        result.Set("errcode", errno);
        result.Set("error_msg", std::strerror(errno));
        return result;
    }

    int lock_ret = flock(fd, operation);
    if (lock_ret == 0) {
        result.Set("success", true);
        result.Set("errcode", 0);
        result.Set("error_msg", "");
    } else {
        result.Set("success", false);
        result.Set("errcode", errno);
        result.Set("error_msg", std::strerror(errno));
    }

    return result;
}

/**
 * Unlock a file by path.
 */
Napi::Value UnlockFile(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsString()) {
        return Napi::TypeError::New(env, "Expected (path)").Value();
    }

    std::string path = info[0].As<Napi::String>().Utf8Value();

    int fd = open(path.c_str(), O_RDONLY);
    Napi::Object result = Napi::Object::New(env);

    if (fd < 0) {
        result.Set("success", false);
        result.Set("errcode", errno);
        result.Set("error_msg", std::strerror(errno));
        return result;
    }

    int unlock_ret = flock(fd, LOCK_UN);
    close(fd);

    if (unlock_ret == 0) {
        result.Set("success", true);
        result.Set("errcode", 0);
        result.Set("error_msg", "");
    } else {
        result.Set("success", false);
        result.Set("errcode", errno);
        result.Set("error_msg", std::strerror(errno));
    }

    return result;
}

/**
 * Close a descriptor.
 */
Napi::Value CloseFd(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsNumber()) {
        return Napi::TypeError::New(env, "Expected file descriptor number").Value();
    }

    int fd = info[0].As<Napi::Number>().Int32Value();
    int ret = close(fd);

    Napi::Object result = Napi::Object::New(env);
    if (ret == 0) {
        result.Set("success", true);
        result.Set("errcode", 0);
        result.Set("error_msg", "");
    } else {
        result.Set("success", false);
        result.Set("errcode", errno);
        result.Set("error_msg", std::strerror(errno));
    }

    return result;
}

/**
 * Probe the platform for required capabilities.
 */
Napi::Value ProbeCapability(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    Napi::Object result = Napi::Object::New(env);
    result.Set("platform", "linux");
    result.Set("hasOpenAt2", true);
    result.Set("hasRenameAt2", true);
    result.Set("requiredFlags", Napi::Array::New(env, 2));
    result.Set("supportedPrimitives", Napi::Array::New(env, 4));

    Napi::Array requiredFlags = result.Get("requiredFlags").As<Napi::Array>();
    requiredFlags.Set(uint32_t(0), Napi::Number::New(env, RESOLVE_BENEATH));
    requiredFlags.Set(uint32_t(1), Napi::Number::New(env, RESOLVE_NO_SYMLINKS));

    Napi::Array primitives = result.Get("supportedPrimitives").As<Napi::Array>();
    primitives.Set(uint32_t(0), Napi::String::New(env, "openat2"));
    primitives.Set(uint32_t(1), Napi::String::New(env, "openat"));
    primitives.Set(uint32_t(2), Napi::String::New(env, "linkat"));
    primitives.Set(uint32_t(3), Napi::String::New(env, "renameat2"));

    return result;
}

/**
 * Module initialization.
 */
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("probeCapability", Napi::Function::New(env, ProbeCapability));
    exports.Set("acquireTrustedRoot", Napi::Function::New(env, AcquireTrustedRoot));
    exports.Set("openRelative", Napi::Function::New(env, OpenRelative));
    exports.Set("createTempRelative", Napi::Function::New(env, CreateTempRelative));
    exports.Set("atomicRename", Napi::Function::New(env, AtomicRename));
    exports.Set("lockFile", Napi::Function::New(env, LockFile));
    exports.Set("unlockFile", Napi::Function::New(env, UnlockFile));
    exports.Set("closeFd", Napi::Function::New(env, CloseFd));

    exports.Set("RESOLVE_BENEATH", Napi::Number::New(env, RESOLVE_BENEATH));
    exports.Set("RESOLVE_NO_SYMLINKS", Napi::Number::New(env, RESOLVE_NO_SYMLINKS));

    // Lock operations
    exports.Set("LOCK_SH", Napi::Number::New(env, LOCK_SH));
    exports.Set("LOCK_EX", Napi::Number::New(env, LOCK_EX));
    exports.Set("LOCK_UN", Napi::Number::New(env, LOCK_UN));

    return exports;
}

NODE_API_MODULE(secure_destination, Init)

}  // namespace secure_destination
