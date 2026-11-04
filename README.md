# 大混戰速查

把 OP.GG「隨機單中：大混戰」的強化符文、裝備、技能點法放在同一頁，適合放在第二螢幕看。

- `scraper/scrape.py`：抓 OP.GG 資料，輸出到 `site/data/`（只用 Python 標準函式庫）
- `site/`：靜態網頁（index.html、app.js、style.css、aliases.js 暱稱表）
- `.github/workflows/update.yml`：每天台灣時間 04:00 自動抓資料並部署到 GitHub Pages

## 本機使用

```bash
python -X utf8 scraper/scrape.py
python -m http.server 8765 --directory site
```

接著打開 http://localhost:8765 。只想抓幾隻英雄測試：`python -X utf8 scraper/scrape.py --only kaisa,teemo`

## 部署到 GitHub Pages

1. 在 GitHub 建立一個新的 repository，把這個資料夾推上去（main 分支）。
2. 到 repository 的 **Settings → Pages**，把 **Source** 設成 **GitHub Actions**。
3. 到 **Actions** 分頁，選「每日更新資料並部署」，按 **Run workflow** 跑第一次。
4. 完成後網址是 `https://<你的帳號>.github.io/<repository 名稱>/`，分享給好友即可。

## 注意

- 資料來自 OP.GG 非公開的頁面資料，OP.GG 改版時抓取程式可能需要修改。網址請只在好友間分享。
- 新版本剛開始時樣本很少，勝率僅供參考；頁面會把少於 5 場的列調淡。
- 暱稱可在 `site/aliases.js` 自行增加。
