export default function handler(req, res) {
  const { title = "Mission ALANE", date, start = "08:00", end = "17:00", location = "", description = "" } = req.query;

  if (!date) return res.status(400).json({ error: "date requis (YYYY-MM-DD)" });

  const toIcsDt = (dateStr, timeStr) => {
    const [y, m, d] = dateStr.split("-");
    const [hh, mm] = timeStr.split(":");
    return `${y}${m.padStart(2,"0")}${d.padStart(2,"0")}T${hh.padStart(2,"0")}${mm.padStart(2,"0")}00`;
  };

  const uid = `${Date.now()}@alane.fr`;
  const dtStart = toIcsDt(date, start);
  const dtEnd   = toIcsDt(date, end);
  const now     = new Date().toISOString().replace(/[-:]/g,"").slice(0,15);

  const ics = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ALANE//Mission//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${now}`,
    `DTSTART:${dtStart}`,
    `DTEND:${dtEnd}`,
    `SUMMARY:${title.replace(/,/g,"\\,")}`,
    `LOCATION:${location.replace(/,/g,"\\,")}`,
    `DESCRIPTION:${description.replace(/,/g,"\\,")}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");

  res.setHeader("Content-Type", "text/calendar; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="mission-alane.ics"`);
  res.status(200).send(ics);
}
