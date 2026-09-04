# LINEスタンプ切り出しメーカー（試作版）

iPhone SE2 / Androidタブレット向けのブラウザアプリです。

## GitHub Pagesで公開
1. GitHubで新しいPublic repositoryを作成（例: `line-sticker-cutter`）
2. `index.html`, `style.css`, `script.js` の3ファイルをアップロード
3. Settings → Pages → Deploy from a branch → `main` / `/ (root)` → Save
4. 数分後に表示されたURLをiPhoneのSafariで開く
5. Safariの共有ボタン →「ホーム画面に追加」でアプリ風に使えます

## 注意
- 画像の切り抜き・簡易背景透過は端末内で処理します。
- ZIP作成だけJSZip CDNを利用します。完全オフライン化する場合はJSZipを同梱できます。
- 背景透過は「外周から連結した白〜ほぼ白」を透明にする簡易方式です。人物・イラスト内部の白はなるべく残します。
