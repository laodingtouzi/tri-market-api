const { ghGetFile, ghPutFile, setCors } = require('./_lib/github.js');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });

  try {
    const body = req.body || {};
    const { code, action } = body;
    if (!code) return res.status(400).json({ error: 'Missing code' });

    if (action === 'add') {
      for (const m of ['CN', 'HK', 'US']) {
        const postSellPath = `data/portfolio/post_sell_${m}.json`;
        const data = await ghGetFile(token, postSellPath);
        if (data && data.content[code]) {
          delete data.content[code];
          await ghPutFile(token, postSellPath, data.content, data.sha, `Delist: ${code}`);
          return res.json({ success: true, message: `${code} 已从观察清单移除` });
        }
      }
      return res.status(404).json({ error: 'Stock not found in post_sell' });
    }

    return res.status(400).json({ error: 'Invalid action' });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
