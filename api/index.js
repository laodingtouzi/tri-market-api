module.exports = async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  if (!GITHUB_TOKEN) {
    return res.status(500).json({ error: 'GITHUB_TOKEN not configured' });
  }

  const REPO_OWNER = 'laodingtouzi';
  const REPO_NAME = 'laodinglab';

  let body = {};
  try {
    if (req.body) body = req.body;
  } catch (e) {}

  const action = body.action;

  try {
    if (action === 'sell') {
      return await handleManualSell(body, GITHUB_TOKEN, REPO_OWNER, REPO_NAME, res);
    } else if (action === 'add') {
      return await handleManualAdd(body, GITHUB_TOKEN, REPO_OWNER, REPO_NAME, res);
    } else if (action === 'reduce') {
      return await handleManualReduce(body, GITHUB_TOKEN, REPO_OWNER, REPO_NAME, res);
    } else if (action === 'delist') {
      return await handleDelist(body, GITHUB_TOKEN, REPO_OWNER, REPO_NAME, res);
    } else {
      return res.status(400).json({ error: 'Unknown action: ' + action });
    }
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};

// ========== GitHub API helpers ==========
const fetch = require('node-fetch');

async function ghGetFile(token, owner, repo, path) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const resp = await fetch(url, {
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'tri-market-api'
    }
  });
  if (resp.status === 404) return null;
  if (!resp.ok) throw new Error(`GitHub GET ${path} failed: ${resp.status}`);
  const data = await resp.json();
  return {
    content: JSON.parse(Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf-8')),
    sha: data.sha
  };
}

async function ghPutFile(token, owner, repo, path, content, sha, message) {
  const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`;
  const body = {
    message: message,
    content: Buffer.from(JSON.stringify(content, null, 2), 'utf-8').toString('base64')
  };
  if (sha) body.sha = sha;

  const resp = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'tri-market-api'
    },
    body: JSON.stringify(body)
  });
  if (!resp.ok && resp.status !== 201) {
    const err = await resp.text().catch(() => '');
    throw new Error(`GitHub PUT ${path} failed: ${resp.status} ${err.slice(0, 200)}`);
  }
  return true;
}

// ========== Handlers ==========

async function handleManualSell(body, token, owner, repo, res) {
  const { code, market } = body;
  if (!code || !market) return res.status(400).json({ error: 'Missing code or market' });

  const m = market.toUpperCase();
  const holdingsPath = `data/portfolio/holdings_${m}.json`;
  const postSellPath = `data/portfolio/post_sell_${m}.json`;

  const holdingsData = await ghGetFile(token, owner, repo, holdingsPath);
  if (!holdingsData || !holdingsData.content[code]) {
    return res.status(404).json({ error: 'Stock not found in holdings: ' + code });
  }

  const h = holdingsData.content[code];
  const sellPrice = body.sell_price || h.current_price || 0;
  const reason = body.reason || body.sell_reason || '手工卖出';

  delete holdingsData.content[code];

  let postSellData = await ghGetFile(token, owner, repo, postSellPath);
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

  await ghPutFile(token, owner, repo, holdingsPath, holdingsData.content, holdingsData.sha, `Manual sell: ${code}`);
  await ghPutFile(token, owner, repo, postSellPath, postSellData.content, postSellData.sha, `Manual sell post: ${code}`);

  return res.json({ success: true, message: `${code} 手工卖出成功`, code, sold_out: true });
}

async function handleManualAdd(body, token, owner, repo, res) {
  const { code, market } = body;
  if (!code || !market) return res.status(400).json({ error: 'Missing code or market' });

  const sharesVal = parseInt(body.add_shares || body.shares, 10);
  const addPrice = parseFloat(body.add_price);
  if (!sharesVal || sharesVal <= 0 || isNaN(sharesVal) || isNaN(addPrice)) {
    return res.status(400).json({ error: 'Invalid shares or price' });
  }

  const m = market.toUpperCase();
  const holdingsPath = `data/portfolio/holdings_${m}.json`;

  const holdingsData = await ghGetFile(token, owner, repo, holdingsPath);
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

  await ghPutFile(token, owner, repo, holdingsPath, holdingsData.content, holdingsData.sha, `Manual add: ${code} +${sharesVal}@${addPrice}`);

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
}

async function handleManualReduce(body, token, owner, repo, res) {
  const { code, market } = body;
  if (!code || !market) return res.status(400).json({ error: 'Missing code or market' });

  const sharesVal = parseInt(body.reduce_shares || body.shares, 10);
  if (!sharesVal || sharesVal <= 0 || isNaN(sharesVal)) {
    return res.status(400).json({ error: 'Invalid shares' });
  }

  const m = market.toUpperCase();
  const holdingsPath = `data/portfolio/holdings_${m}.json`;
  const postSellPath = `data/portfolio/post_sell_${m}.json`;

  const holdingsData = await ghGetFile(token, owner, repo, holdingsPath);
  if (!holdingsData || !holdingsData.content[code]) {
    return res.status(404).json({ error: 'Stock not found in holdings: ' + code });
  }

  const h = holdingsData.content[code];
  const oldShares = h.shares || 0;
  const newShares = Math.max(0, oldShares - sharesVal);

  if (newShares === 0) {
    let postSellData = await ghGetFile(token, owner, repo, postSellPath);
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

    await ghPutFile(token, owner, repo, holdingsPath, holdingsData.content, holdingsData.sha, `Manual reduce to 0: ${code}`);
    await ghPutFile(token, owner, repo, postSellPath, postSellData.content, postSellData.sha, `Manual reduce post: ${code}`);

    return res.json({ success: true, message: `${code} 已清仓`, code, new_shares: 0, sold_out: true });
  }

  h.shares = newShares;
  h.market_value = newShares * (h.current_price || h.entry_price || 0);
  h.cost = Math.round(newShares * h.entry_price * 100) / 100;
  if (h.entry_price > 0) {
    h.total_return = Math.round(((h.current_price || h.entry_price) - h.entry_price) / h.entry_price * 10000) / 100;
  }

  await ghPutFile(token, owner, repo, holdingsPath, holdingsData.content, holdingsData.sha, `Manual reduce: ${code} -${sharesVal}`);

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
}

async function handleDelist(body, token, owner, repo, res) {
  const { code, action } = body;
  if (!code) return res.status(400).json({ error: 'Missing code' });

  for (const m of ['CN', 'HK', 'US']) {
    const postSellPath = `data/portfolio/post_sell_${m}.json`;
    const data = await ghGetFile(token, owner, repo, postSellPath);
    if (data && data.content[code]) {
      delete data.content[code];
      await ghPutFile(token, owner, repo, postSellPath, data.content, data.sha, `Delist: ${code}`);
      return res.json({ success: true, message: `${code} 已从观察清单移除` });
    }
  }
  return res.status(404).json({ error: 'Stock not found in post_sell' });
}
