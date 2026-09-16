import { bearerToken } from "../utils/security.js";
import { logWarn } from "../utils/logger.js";

export function socketAuth(supabase, prisma) {
  return async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || bearerToken(socket.handshake.headers.authorization);
      if (typeof token !== "string" || !token || token.length > 8192) throw new Error("Missing or invalid socket token");
      const { data, error } = await supabase.auth.getUser(token);
      if (error || !data?.user) throw new Error("Socket token verification failed");
      const user = await prisma.user.findUnique({ where: { id: data.user.id }, select: { status: true } });
      if (!user || user.status !== "ACTIVE") throw new Error("Socket account missing or inactive");
      socket.data.userId = data.user.id;
      next();
    } catch (error) {
      logWarn("socket.authentication_failed", error, {
        headers: socket.handshake.headers,
        body: { token: socket.handshake.auth?.token },
      }, { socketId: socket.id });
      next(new Error("Unauthorized"));
    }
  };
}

export function joinOwnRoom(socket) {
  socket.join(`user:${socket.data.userId}`);
  // Keep compatibility with old clients, but never trust their room/user ID.
  socket.on("join", () => socket.join(`user:${socket.data.userId}`));
}
