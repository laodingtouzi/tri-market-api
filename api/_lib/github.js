const fetch = require('node-fetch');

const REPO_OWNER = 'laodingtouzi';
const REPO_NAME = 'laodinglab';

async function ghGetFile(token, path) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;
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

async function ghPutFile(token, path, content, sha, message) {
  const url = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/${path}`;
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

function setCors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

module.exports = { ghGetFile, ghPutFile, setCors, REPO_OWNER, REPO_NAME };
