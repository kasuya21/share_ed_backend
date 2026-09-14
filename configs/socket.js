let _io = null;

export function initIO(io) {
  _io = io;
}

export function getIO() {
  return _io;
}
