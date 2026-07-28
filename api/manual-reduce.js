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

    const sharesVal = parseInt(body.reduce_shares || body.shares, 10);
    if (!sharesVal || sharesVal <= 0 || isNaN(sharesVal)) {
      return res.status(400).json({ error: 'Invalid shares' });
    }

    const m = market.toUpperCase();
    const holdingsPath = `data/portfolio/holdings_${m}.json`;
    const postSellPath = `data/portfolio/post_sell_${m}.json`;

    const holdingsData = await ghGetFile(token, holdingsPath);
    if (!holdingsData || !holdingsData.content[code]) {
      return res.status(404).json({ error: 'Stock not found in holdings: ' + code });
    }

    const h = holdingsData.content[code];
    const oldShares = h.shares || 0;
    const newShares = Math.max(0, oldShares - sharesVal);

    if (newShares === 0) {
      let postSellData = await ghGetFile(token, postSellPath);
      if (!postSellData) postSellData = { content: {}, sha: null };

      postSellData.content[code] = {
        name: h.name,
        market: m,
        sell_date: new Date().toISOString().split('T')[0],
        sell_price: h.current_price || 0,
        total_return_when_sold: h.total_return || 0,
        hold_days: h.hold_days || 0,
        post_sell_analysis: '手工减仓至0',
        manual_sell: true,
      };
      delete holdingsData.content[code];

      await ghPutFile(token, holdingsPath, holdingsData.content, holdingsData.sha, `Manual reduce to 0: ${code}`);
      await ghPutFile(token, postSellPath, postSellData.content, postSellData.sha, `Manual reduce post: ${code}`);

      return res.json({ success: true, message: `${code} 已清仓`, code, new_shares: 0, sold_out: true });
    }

    h.shares = newShares;
    h.market_value = newShares * (h.current_price || h.entry_price || 0);
    h.cost = Math.round(newShares * h.entry_price * 100) / 100;
    if (h.entry_price > 0) {
      h.total_return = Math.round(((h.current_price || h.entry_price) - h.entry_price) / h.entry_price * 10000) / 100;
    }

    await ghPutFile(token, holdingsPath, holdingsData.content, holdingsData.sha, `Manual reduce: ${code} -${sharesVal}`);

    return res.json({
      success: true,
      message: `${code} 减仓 ${sharesVal} 股成功`,
      code,
      new_shares: newShares,
      updated_stock: {
        code,
        name: h.name,
        market: m,
        status: h.status,
        latest_score: h.latest_score,
        current_price: h.current_price,
        shares: h.shares,
        total_return: h.total_return,
        hold_days: h.hold_days,
        entry_price: h.entry_price,
        market_value: h.market_value,
      }
    });

    return res.json({
      success: true,
      message: `${code} 减仓 ${sharesVal} 股成功`,
      code,
      new_shares: newShares,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
