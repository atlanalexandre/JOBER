export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
  const { pin } = req.body;
  if (!pin || typeof pin !== "string") return res.status(400).json({ ok: false });
  const BO_PIN = process.env.BO_PIN || "1234";
  if (pin === BO_PIN) return res.status(200).json({ ok: true });
  return res.status(401).json({ ok: false });
}
