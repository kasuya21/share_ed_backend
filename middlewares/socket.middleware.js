import { bearerToken } from "../utils/security.js";
import { logWarn } from "../utils/logger.js";
import { verifyAccessToken } from "../utils/auth-token.js";

export function socketAuth(supabase, prisma) {
  return async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || bearerToken(socket.handshake.headers.authorization);
      if (typeof token !== "string" || !token || token.length > 8192) throw new Error("Missing or invalid socket token");
      const { user: tokenUser, error } = await verifyAccessToken(supabase, token);
      if (error || !tokenUser) throw new Error("Socket token verification failed");
      const user = await prisma.user.findUnique({
        where: { id: tokenUser.id },
        select: { status: true, role: true },
      });
      if (!user || user.status !== "ACTIVE") throw new Error("Socket account missing or inactive");
      socket.data.userId = tokenUser.id;
      socket.data.role = user.role;
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
  if (socket.data.role === "ADMIN") {
    socket.join("role:admin");
  }
  // Keep compatibility with old clients, but never trust their room/user ID.
  socket.on("join", () => socket.join(`user:${socket.data.userId}`));
}
