export const authenticateJwt = (req: any, res: any, next: any) => {
  req.user = { id: "00000000-0000-0000-0000-000000000001", role: "user" };
  next();
};
