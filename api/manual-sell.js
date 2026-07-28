const { ghGetFile, ghPutFile, setCors } = require('./_lib/github.js');

module.exports = async (req, res) => {
  setCors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = process.env.GITHUB_TOKEN;
  if (!token) return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });

  try {
    const body = req.body || {};
    const { code, market } = body;
    if (!code || !market) return res.status(400).json({ error: 'Missing code or market' });

    const m = market.toUpperCase();
    const holdingsPath = `data/portfolio/holdings_${m}.json`;
    const postSellPath = `data/portfolio/post_sell_${m}.json`;

    const holdingsData = await ghGetFile(token, holdingsPath);
    if (!holdingsData || !holdingsData.content[code]) {
      return res.status(404).json({ error: 'Stock not found in holdings: ' + code });
    }

    const h = holdingsData.content[code];
    const sellPrice = body.sell_price || h.current_price || 0;
    const reason = body.reason || body.sell_reason || '手工卖出';

    delete holdingsData.content[code];

    let postSellData = await ghGetFile(token, postSellPath);
    if (!postSellData) postSellData = { content: {}, sha: null };

    postSellData.content[code] = {
      name: h.name,
      market: m,
      sell_date: new Date().toISOString().split('T')[0],
      sell_price: sellPrice,
      total_return_when_sold: h.total_return || 0,
      hold_days: h.hold_days || 0,
      post_sell_analysis: reason,
      manual_sell: true,
    };

    await ghPutFile(token, holdingsPath, holdingsData.content, holdingsData.sha, `Manual sell: ${code}`);
    await ghPutFile(token, postSellPath, postSellData.content, postSellData.sha, `Manual sell post: ${code}`);

    return res.json({ success: true, message: `${code} 手工卖出成功`, code, sold_out: true });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
