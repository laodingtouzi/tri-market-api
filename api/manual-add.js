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

    const sharesVal = parseInt(body.add_shares || body.shares, 10);
    const addPrice = parseFloat(body.add_price);
    if (!sharesVal || sharesVal <= 0 || isNaN(sharesVal) || isNaN(addPrice)) {
      return res.status(400).json({ error: 'Invalid shares or price' });
    }

    const m = market.toUpperCase();
    const holdingsPath = `data/portfolio/holdings_${m}.json`;

    const holdingsData = await ghGetFile(token, holdingsPath);
    if (!holdingsData || !holdingsData.content[code]) {
      return res.status(404).json({ error: 'Stock not found in holdings: ' + code });
    }

    const h = holdingsData.content[code];
    const oldShares = h.shares || 0;
    const oldCost = oldShares * (h.entry_price || 0);
    const newCost = sharesVal * addPrice;
    const totalShares = oldShares + sharesVal;
    const avgPrice = totalShares > 0 ? (oldCost + newCost) / totalShares : 0;

    h.shares = totalShares;
    h.entry_price = Math.round(avgPrice * 100) / 100;
    h.market_value = totalShares * (h.current_price || addPrice);
    if (h.entry_price > 0) {
      h.total_return = Math.round(((h.current_price || addPrice) - h.entry_price) / h.entry_price * 10000) / 100;
    }
    h.cost = Math.round(totalShares * h.entry_price * 100) / 100;

    await ghPutFile(token, holdingsPath, holdingsData.content, holdingsData.sha, `Manual add: ${code} +${sharesVal}@${addPrice}`);

    return res.json({
      success: true,
      message: `${code} 加仓 ${sharesVal} 股成功`,
      code,
      new_shares: totalShares,
      new_entry_price: h.entry_price,
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
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
