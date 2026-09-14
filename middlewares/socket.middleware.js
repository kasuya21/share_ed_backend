import { bearerToken } from "../utils/security.js";

export function socketAuth(supabase, prisma) {
  return async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || bearerToken(socket.handshake.headers.authorization);
      if (typeof token !== "string" || !token || token.length > 8192) throw new Error();
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data?.user) throw new Error();
      const user = await prisma.user.findUnique({ where: { id: data.user.id }, select: { status: true } });
      if (!user || user.status !== "ACTIVE") throw new Error();
      socket.data.userId = data.user.id;
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  };
}

export function joinOwnRoom(socket) {
  socket.join(`user:${socket.data.userId}`);
  // Keep compatibility with old clients, but never trust their room/user ID.
  socket.on("join", () => socket.join(`user:${socket.data.userId}`));
}
