export function validatePassword(password) {
  if (typeof password !== "string") {
    return [{ code: "INVALID_TYPE", message: "รหัสผ่านต้องเป็นข้อความ" }];
  }
  const errors = [];
  if (password.length < 8 || password.length > 128) {
    errors.push({ code: "LENGTH", message: "รหัสผ่านต้องมีความยาว 8–128 ตัวอักษร" });
  }
  for (const [pattern, code, message] of [
    [/[A-Z]/, "UPPERCASE", "ต้องมีตัวอักษรพิมพ์ใหญ่ A–Z อย่างน้อย 1 ตัว"],
    [/[a-z]/, "LOWERCASE", "ต้องมีตัวอักษรพิมพ์เล็ก a–z อย่างน้อย 1 ตัว"],
    [/[0-9]/, "NUMBER", "ต้องมีตัวเลข 0–9 อย่างน้อย 1 ตัว"],
  ]) {
    if (!pattern.test(password)) errors.push({ code, message });
  }
  // Never trim, normalize, log or echo passwords.
  return errors;
}
