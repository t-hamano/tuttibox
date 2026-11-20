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

## リリース（署名・公証）

`v1.2.3` 形式のタグを push すると、GitHub Actions（`.github/workflows/release.yml`）が macOS / Windows 版をビルドし、ドラフトリリースにアップロードします。

- macOS: Developer ID Application で署名し、Apple の公証（notarization）を行う。Universal（Intel / Apple Silicon 両対応）
- Windows: 未署名（x64 / arm64）

必要なリポジトリシークレット（MarkBricks と同じ名前）:

| シークレット | 内容 |
|---|---|
| `APPLE_CERTIFICATE` | Developer ID Application 証明書（.p12）を base64 化した文字列 |
| `APPLE_CERTIFICATE_PASSWORD` | .p12 のパスワード |
| `APPLE_SIGNING_IDENTITY` | `Developer ID Application: 名前 (TEAMID)` |
| `APPLE_ID` | Apple ID のメールアドレス |
| `APPLE_PASSWORD` | Apple ID の App 用パスワード |
| `APPLE_TEAM_ID` | チーム ID |

ローカルの Mac で署名付きビルドを作る場合は、キーチェーンに証明書が入った状態で次を実行します。

```bash
APPLE_ID=... APPLE_APP_SPECIFIC_PASSWORD=... APPLE_TEAM_ID=... npm run dist:mac
```

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
