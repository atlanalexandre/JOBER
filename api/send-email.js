export async function sendEmail({ to, subject, text }) {
  const key  = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || "JOBER <onboarding@resend.dev>";
  if (!key) return;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { "Authorization": `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to: Array.isArray(to) ? to : [to], subject, text }),
    });
    if (!r.ok) console.error("Resend error:", await r.text());
  } catch (e) {
    console.error("sendEmail error:", e);
  }
}
