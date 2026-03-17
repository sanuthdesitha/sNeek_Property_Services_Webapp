const fs = require("fs");
const fsPromises = require("fs/promises");

function normalizeEisdirAsEinval(err) {
  if (!err || err.code !== "EISDIR") return err;
  const next = new Error(err.message);
  next.code = "EINVAL";
  next.errno = err.errno;
  next.syscall = err.syscall;
  next.path = err.path;
  return next;
}

const originalReadlink = fs.readlink;
fs.readlink = function patchedReadlink(path, options, callback) {
  if (typeof options === "function") {
    callback = options;
    options = undefined;
  }
  return originalReadlink.call(fs, path, options, (err, linkString) => {
    callback(normalizeEisdirAsEinval(err), linkString);
  });
};

const originalReadlinkSync = fs.readlinkSync;
fs.readlinkSync = function patchedReadlinkSync(path, options) {
  try {
    return originalReadlinkSync.call(fs, path, options);
  } catch (err) {
    throw normalizeEisdirAsEinval(err);
  }
};

const originalPromisesReadlink = fsPromises.readlink;
fsPromises.readlink = async function patchedPromisesReadlink(path, options) {
  try {
    return await originalPromisesReadlink.call(fsPromises, path, options);
  } catch (err) {
    throw normalizeEisdirAsEinval(err);
  }
};

if (fs.promises && typeof fs.promises.readlink === "function") {
  fs.promises.readlink = fsPromises.readlink;
}
