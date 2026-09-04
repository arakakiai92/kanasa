# LINEスタンプ・絵文字メーカー v2

iPhone SE2 / Androidタブレット向け試作版。

## 主な変更点
- スタンプ：370:320の固定比率
- 絵文字：1:1の固定比率
- シート上で指でざっくり範囲指定
- 「次へ：細かく調整」で2段階目へ
- 調整画面でも比率固定
- 背景透過をON/OFF
- 透過結果をチェッカー背景でプレビュー
- スタンプは370×320、絵文字は180×180でPNG書き出し
- 1MB超過の簡易チェック
- 個別PNG保存、ZIP一括保存

## GitHub Pages
1. Public repositoryを作成
2. このフォルダの `index.html`, `style.css`, `script.js` をアップロード
3. Settings → Pages → Deploy from a branch → main / root
4. 発行されたURLをiPhone Safariで開く

※ ZIP生成のためJSZipをCDNから読み込みます。
※ 背景透過は「外周とつながった白〜薄色背景」を消す方式です。複雑な背景では完全除去できない場合があります。
※ LINEの最新の審査規定が変更された場合、アプリ側の仕様も更新してください。
