export default function handler(req, res) {
  res.status(200).json({ ok: true, pong: new Date().toISOString() });
}
