import bcrypt from "bcryptjs";
export const hashPassword = (pw: string) => bcrypt.hash(pw, 10);
