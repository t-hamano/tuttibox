# Tuttibox

Gmail・Chatwork・Google カレンダー・Google Keep を 1 つのウィンドウにまとめる、Windows / macOS 向けの軽量デスクトップアプリです。

## 機能

- 左のサイドバーでサービスを切り替え、右側に表示
- 左下の「+」からサービスを追加（同じサービスを複数追加可。例: Gmail を 2 アカウント）
- サイドバーのアイコンはドラッグ & ドロップで並び替え
- アイコンの右クリックメニュー: 再読み込み / 編集 / 削除
- 編集画面で、名前・未読バッジの表示有無・カスタム CSS・カスタム JavaScript を設定
- サービスごとにログイン状態を分離して保持（`persist:<id>` セッション）
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

## カスタム CSS / JavaScript

サイドバーのアイコンを右クリック →「編集…」で設定します。

- CSS: 保存するとすぐ反映され、ページを読み込むたびに注入されます
- JavaScript: ページを読み込むたびに実行されます。変更して保存するとページを再読み込みします

設定は `settings.json`（macOS: `~/Library/Application Support/Tuttibox/`、Windows: `%APPDATA%\Tuttibox\`）に保存されます。

## 未読バッジ

ページタイトル中の `(数字)` を未読数として読み取ります（Gmail、Chatwork）。Google カレンダーと Google Keep はタイトルに未読数が出ないため、バッジはありません。

## ショートカット

| 操作 | macOS | Windows |
|---|---|---|
| サービス切り替え（上から 9 個まで） | `Cmd+1`〜`Cmd+9` | `Ctrl+1`〜`Ctrl+9` |
| 再読み込み | `Cmd+R` | `Ctrl+R` |
| 戻る / 進む | `Cmd+[` / `Cmd+]` | `Alt+←` / `Alt+→` |
| 拡大 / 縮小 / 実寸 | `Cmd+Plus` / `Cmd+-` / `Cmd+0` | `Ctrl+Plus` / `Ctrl+-` / `Ctrl+0` |
| 開発者ツール | `Alt+Cmd+I` | `Ctrl+Shift+I` |

## 構成

```
src/
  main/
    main.ts       ウィンドウ・ビュー管理、サービスの追加/削除/並び替え、バッジ集計、メニュー
    services.ts   追加できるサービスの種類（URL・バッジの読み取り方法）
    settings.ts   サービス一覧・ウィンドウ位置などの保存
  preload/
    sidebar.ts    サイドバー用 API
    service.ts    Web 通知クリックの検知
    edit.ts       編集画面用 API
  renderer/
    sidebar.*     サイドバー UI
    edit.*        サービスの編集画面
```
