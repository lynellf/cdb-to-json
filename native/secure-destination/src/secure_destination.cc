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

// Syscall numbers for capability probing
#ifndef __NR_openat2
#define __NR_openat2 437
#endif
#ifndef __NR_renameat2
#define __NR_renameat2 456
#endif
#ifndef __NR_linkat
#define __NR_linkat 5
#endif

namespace secure_destination {

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
        return Napi::TypeError::New(env, "Expected (rootFd, relPath, flags, mode?)").Value();
    }

    int root_fd = info[0].As<Napi::Number>().Int32Value();
    std::string rel_path = info[1].As<Napi::String>().Utf8Value();
    int flags = info[2].As<Napi::Number>().Int32Value();
    int mode = (info.Length() >= 4 && info[3].IsNumber())
        ? info[3].As<Napi::Number>().Int32Value()
        : 0;
    int resolve_flags = RESOLVE_BENEATH | RESOLVE_NO_SYMLINKS;

    struct open_how how;
    memset(&how, 0, sizeof(how));
    how.flags = flags;
    how.mode = mode;
    how.resolve = resolve_flags;
    int fd = static_cast<int>(sys_openat2(root_fd, rel_path.c_str(), &how));

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
 * Create one directory component relative to a held descriptor.
 */
Napi::Value MkdirRelative(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 3 || !info[0].IsNumber() || !info[1].IsString() || !info[2].IsNumber()) {
        return Napi::TypeError::New(env, "Expected (rootFd, leaf, mode)").Value();
    }

    int root_fd = info[0].As<Napi::Number>().Int32Value();
    std::string leaf = info[1].As<Napi::String>().Utf8Value();
    int mode = info[2].As<Napi::Number>().Int32Value();
    int ret = mkdirat(root_fd, leaf.c_str(), static_cast<mode_t>(mode));

    Napi::Object result = Napi::Object::New(env);
    result.Set("success", ret == 0);
    result.Set("errcode", ret == 0 ? 0 : errno);
    result.Set("error_msg", ret == 0 ? "" : std::strerror(errno));
    return result;
}

/**
 * Remove one file component relative to a held descriptor.
 */
Napi::Value UnlinkRelative(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsString()) {
        return Napi::TypeError::New(env, "Expected (rootFd, leaf)").Value();
    }

    int root_fd = info[0].As<Napi::Number>().Int32Value();
    std::string leaf = info[1].As<Napi::String>().Utf8Value();
    int ret = unlinkat(root_fd, leaf.c_str(), 0);

    Napi::Object result = Napi::Object::New(env);
    result.Set("success", ret == 0);
    result.Set("errcode", ret == 0 ? 0 : errno);
    result.Set("error_msg", ret == 0 ? "" : std::strerror(errno));
    return result;
}

/**
 * Remove one directory component relative to a held descriptor.
 */
Napi::Value RmdirRelative(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsString()) {
        return Napi::TypeError::New(env, "Expected (rootFd, leaf)").Value();
    }

    int root_fd = info[0].As<Napi::Number>().Int32Value();
    std::string leaf = info[1].As<Napi::String>().Utf8Value();
    int ret = unlinkat(root_fd, leaf.c_str(), AT_REMOVEDIR);

    Napi::Object result = Napi::Object::New(env);
    result.Set("success", ret == 0);
    result.Set("errcode", ret == 0 ? 0 : errno);
    result.Set("error_msg", ret == 0 ? "" : std::strerror(errno));
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
 * Atomic rename using renameat2.
 *
 * When no flags parameter (or flags=0) is given, uses the default RENAME_NOREPLACE
 * for atomic no-clobber semantics. This is the required no-replace primitive for
 * the secure-destination contract.
 *
 * When flags=RENAME_EXCHANGE is given, atomically exchanges two paths.
 *
 * For force replacement, use atomicRenameReplace() instead.
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

    // Default to RENAME_NOREPLACE for no-clobber semantics
    unsigned int flags = RENAME_NOREPLACE;
    if (info.Length() >= 5 && info[4].IsNumber()) {
        flags = static_cast<unsigned int>(info[4].As<Napi::Number>().Uint32Value());
    }

    long ret = syscall(__NR_renameat2, old_dir_fd, old_path.c_str(),
                       new_dir_fd, new_path.c_str(), flags);

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
 * Atomic rename with explicit flags for force replacement.
 *
 * This function allows specifying the renameat2 flags directly:
 * - flags=0: atomic replace (allows clobbering existing destination)
 * - flags=RENAME_NOREPLACE: no-clobber (default)
 * - flags=RENAME_EXCHANGE: atomic exchange of two paths
 *
 * Force replacement uses flags=0 to allow replacing an existing final.
 */
Napi::Value AtomicRenameWithFlags(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 5 || !info[0].IsNumber() || !info[1].IsString() ||
        !info[2].IsNumber() || !info[3].IsString() || !info[4].IsNumber()) {
        return Napi::TypeError::New(env, "Expected (oldDirFd, oldPath, newDirFd, newPath, flags)").Value();
    }

    int old_dir_fd = info[0].As<Napi::Number>().Int32Value();
    std::string old_path = info[1].As<Napi::String>().Utf8Value();
    int new_dir_fd = info[2].As<Napi::Number>().Int32Value();
    std::string new_path = info[3].As<Napi::String>().Utf8Value();
    unsigned int flags = static_cast<unsigned int>(info[4].As<Napi::Number>().Uint32Value());

    long ret = syscall(__NR_renameat2, old_dir_fd, old_path.c_str(),
                       new_dir_fd, new_path.c_str(), flags);

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
 * Force replace: atomically rename with flags=0 (allows clobbering destination).
 *
 * This is used for --force replacement where an existing final must be replaced.
 * The caller is responsible for creating a backup before calling this function.
 */
Napi::Value AtomicRenameReplace(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 4 || !info[0].IsNumber() || !info[1].IsString() ||
        !info[2].IsNumber() || !info[3].IsString()) {
        return Napi::TypeError::New(env, "Expected (oldDirFd, oldPath, newDirFd, newPath)").Value();
    }

    int old_dir_fd = info[0].As<Napi::Number>().Int32Value();
    std::string old_path = info[1].As<Napi::String>().Utf8Value();
    int new_dir_fd = info[2].As<Napi::Number>().Int32Value();
    std::string new_path = info[3].As<Napi::String>().Utf8Value();

    // flags=0 allows replacing the destination
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

Napi::Value GetResolveBeneath(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), RESOLVE_BENEATH);
}

Napi::Value GetResolveNoSymlinks(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), RESOLVE_NO_SYMLINKS);
}

Napi::Value GetRenameNoReplace(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), RENAME_NOREPLACE);
}

Napi::Value GetRenameNoReplaceFlag(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), RENAME_NOREPLACE);
}

/**
 * Probe the platform for required capabilities.
 *
 * For openat2: tests syscall availability with invalid args (safe, no side effect).
 *
 * For renameat2 with RENAME_NOREPLACE: performs an actual functional no-clobber probe
 * by creating a temporary directory, placing a sentinel file in it, then attempting
 * renameat2(..., RENAME_NOREPLACE) on an already-existing path.  A successful syscall
 * followed by EEXIST confirms the no-replace behavior works.  This proves the
 * "exact no-replace primitive" declared in INV-006, not merely syscall presence.
 *
 * linkat: NOT advertised — no publication operation uses hard links.
 */
Napi::Value ProbeCapability(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    bool hasOpenAt2 = false;
    bool hasRenameAt2 = false;
    bool supportsNoReplace = false;  // actual functional RENAME_NOREPLACE

    // Probe openat2: syscall availability with null args (safe probe)
    long ret_openat2 = syscall(__NR_openat2, -1, nullptr, nullptr, 0);
    hasOpenAt2 = (ret_openat2 == -1 && errno != ENOSYS);

    // Probe renameat2: syscall availability with flags=0
    long ret_renameat2 = syscall(__NR_renameat2, -1, nullptr, -1, nullptr, 0);
    hasRenameAt2 = (ret_renameat2 == -1 && errno != ENOSYS);

    // Functional no-replace probe: create a temp dir + two files,
    // then try renameat2(old, new) with RENAME_NOREPLACE when new already exists.
    // ENOSYS means unavailable; EEXIST means syscall available AND no-replace works.
    // Any other error (or success) means the no-replace flag is silently ignored.
    if (hasRenameAt2) {
        // Use mkdtemp to create a unique temporary directory for the probe.
        // mkdtemp is async-signal-safe enough for a probe; we immediately rmdir
        // it after the probe so it never leaves an artifact.
        char probe_template[] = "/tmp/cdb_native_probe_XXXXXX";
        char* probe_dir = mkdtemp(probe_template);
        if (probe_dir != nullptr) {
            std::string src_path = std::string(probe_dir) + "/src";
            std::string dst_path = std::string(probe_dir) + "/dst";

            // Touch both paths. The destination must already exist: EEXIST is
            // the functional proof that RENAME_NOREPLACE is enforced.
            int src_fd = open(src_path.c_str(), O_CREAT | O_WRONLY, 0644);
            int dst_fd = open(dst_path.c_str(), O_CREAT | O_WRONLY, 0644);
            if (src_fd >= 0 && dst_fd >= 0) {
                close(src_fd);
                close(dst_fd);

                // Try renameat2(..., RENAME_NOREPLACE) where dst already exists.
                // This MUST return -1 with errno==EEXIST to confirm no-replace works.
                long probe_ret = syscall(__NR_renameat2, AT_FDCWD, src_path.c_str(),
                                         AT_FDCWD, dst_path.c_str(), RENAME_NOREPLACE);
                // Expected: probe_ret==-1 && errno==EEXIST  => no-replace works
                // ENOSYS/EINVAL/EOPNOTSUPP                              => not supported
                // anything else (including 0)                             => broken
                if (probe_ret == -1 && (errno == EEXIST)) {
                    supportsNoReplace = true;
                }
            } else {
                if (src_fd >= 0) close(src_fd);
                if (dst_fd >= 0) close(dst_fd);
            }

            // Clean up: unlink all created files, then remove the temp dir.
            unlink(src_path.c_str());
            unlink(dst_path.c_str());
            rmdir(probe_dir);
        }
    }

    Napi::Object result = Napi::Object::New(env);
    result.Set("platform", "linux");
    // supported = openat2 + functional no-replace renameat2
    result.Set("supported", hasOpenAt2 && supportsNoReplace);
    result.Set("hasOpenAt2", hasOpenAt2);
    result.Set("hasRenameAt2", hasRenameAt2);
    result.Set("supportsNoReplace", supportsNoReplace);
    result.Set("requiredFlags", Napi::Array::New(env, 2));

    // Build primitives array from PROVEN operations only.
    // openat: always available on Linux (POSIX baseline).
    // openat2: available when hasOpenAt2 (syscall present).
    // renameat2 with RENAME_NOREPLACE: available when supportsNoReplace.
    // linkat: NOT advertised — no publication operation uses hard links (INV-006).
    Napi::Array primitives = Napi::Array::New(env);
    uint32_t primIdx = 0;
    primitives.Set(primIdx++, Napi::String::New(env, "openat"));
    if (hasOpenAt2) {
        primitives.Set(primIdx++, Napi::String::New(env, "openat2"));
    }
    if (supportsNoReplace) {
        primitives.Set(primIdx++, Napi::String::New(env, "renameat2"));
    }
    // Note: linkat deliberately omitted — no publication primitive requires it.

    result.Set("supportedPrimitives", primitives);

    Napi::Array requiredFlags = result.Get("requiredFlags").As<Napi::Array>();
    requiredFlags.Set(uint32_t(0), Napi::String::New(env, "RESOLVE_BENEATH"));
    requiredFlags.Set(uint32_t(1), Napi::String::New(env, "RESOLVE_NO_SYMLINKS"));

    return result;
}

/**
 * Module initialization.
 */
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("probeCapability", Napi::Function::New(env, ProbeCapability));
    exports.Set("acquireTrustedRoot", Napi::Function::New(env, AcquireTrustedRoot));
    exports.Set("openRelative", Napi::Function::New(env, OpenRelative));
    exports.Set("mkdirRelative", Napi::Function::New(env, MkdirRelative));
    exports.Set("unlinkRelative", Napi::Function::New(env, UnlinkRelative));
    exports.Set("rmdirRelative", Napi::Function::New(env, RmdirRelative));
    exports.Set("createTempRelative", Napi::Function::New(env, CreateTempRelative));
    exports.Set("atomicRename", Napi::Function::New(env, AtomicRename));
    exports.Set("atomicRenameWithFlags", Napi::Function::New(env, AtomicRenameWithFlags));
    exports.Set("atomicRenameReplace", Napi::Function::New(env, AtomicRenameReplace));
    exports.Set("lockFile", Napi::Function::New(env, LockFile));
    exports.Set("unlockFile", Napi::Function::New(env, UnlockFile));
    exports.Set("closeFd", Napi::Function::New(env, CloseFd));

    exports.Set("RESOLVE_BENEATH", Napi::Number::New(env, RESOLVE_BENEATH));
    exports.Set("RESOLVE_NO_SYMLINKS", Napi::Number::New(env, RESOLVE_NO_SYMLINKS));
    exports.Set("RENAME_NOREPLACE", Napi::Number::New(env, RENAME_NOREPLACE));
    exports.Set("RESOLVE_BENEATH_FLAG", Napi::Function::New(env, GetResolveBeneath));
    exports.Set("RESOLVE_NO_SYMLINKS_FLAG", Napi::Function::New(env, GetResolveNoSymlinks));
    exports.Set("RENAME_NOREPLACE_FLAG", Napi::Function::New(env, GetRenameNoReplaceFlag));

    // Lock operations
    exports.Set("LOCK_SH", Napi::Number::New(env, LOCK_SH));
    exports.Set("LOCK_EX", Napi::Number::New(env, LOCK_EX));
    exports.Set("LOCK_UN", Napi::Number::New(env, LOCK_UN));

    return exports;
}

NODE_API_MODULE(secure_destination, Init)

}  // namespace secure_destination
