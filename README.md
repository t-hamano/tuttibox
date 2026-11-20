# Tuttibox

Gmail・Chatwork・Google カレンダー・Google Keep を 1 つのウィンドウにまとめる、Windows / macOS 向けの軽量デスクトップアプリです。

## 機能

- 左のサイドバーでサービスを切り替え、右側に表示
- サービスごとにログイン状態を分離して保持（`persist:<id>` セッション）
- サービスごとの CSS 注入（保存すると即時反映）
- 未読バッジ（サイドバー）と、合計数のバッジ（macOS: Dock、Windows: タスクバーのオーバーレイアイコン）
- Web 通知のクリックでウィンドウを前面に出し、該当サービスへ切り替え

## 開発

```bash
npm install
npm start
```

## 配布用ビルド

```bash
npm run dist:mac
```

```bash
npm run dist:win
```

成果物は `release/` に出力されます。各 OS のビルドはその OS 上で実行してください。

## CSS 注入

メニュー「ファイル → CSS フォルダを開く」で開くフォルダに、サービスごとの CSS ファイルがあります。

| サービス | ファイル |
|---|---|
| Gmail | `gmail.css` |
| Chatwork | `chatwork.css` |
| Google カレンダー | `google-calendar.css` |
| Google Keep | `google-keep.css` |

## 未読バッジ

ページタイトル中の `(数字)` を未読数として読み取ります（Gmail、Chatwork）。Google カレンダーと Google Keep はタイトルに未読数が出ないため、バッジはありません。

## ショートカット

| 操作 | macOS | Windows |
|---|---|---|
| サービス切り替え | `Cmd+1`〜`Cmd+4` | `Ctrl+1`〜`Ctrl+4` |
| 再読み込み | `Cmd+R` | `Ctrl+R` |
| 戻る / 進む | `Cmd+[` / `Cmd+]` | `Alt+←` / `Alt+→` |
| 拡大 / 縮小 / 実寸 | `Cmd+Plus` / `Cmd+-` / `Cmd+0` | `Ctrl+Plus` / `Ctrl+-` / `Ctrl+0` |
| 開発者ツール | `Alt+Cmd+I` | `Ctrl+Shift+I` |

## 構成

```
src/
  main/
    main.ts       ウィンドウ・ビュー管理、バッジ集計、メニュー
    services.ts   サービス定義（URL・バッジの読み取り方法）
    css.ts        CSS 注入とファイル監視
    settings.ts   ウィンドウ位置・最後に開いたサービスの保存
  preload/
    sidebar.ts    サイドバー用 API
    service.ts    Web 通知クリックの検知
  renderer/
    sidebar.*     サイドバー UI
```
