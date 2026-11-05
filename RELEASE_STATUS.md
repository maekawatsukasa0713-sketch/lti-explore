# 提出の保存確認（2026-11-05）

- 生徒の提出はDB保存の応答を待ち、成功後に本文・添付選択をクリアする。失敗・競合・保存処理中の場合は下書きを保持し、成功表示しない。
- アップロード中から二重送信を防止。同じ添付の保存再試行ではアップロード済みパスを再利用する。
- DB保存後の再読込失敗は保存済みと表示し、再送信ではなく表示更新を案内する。
- 再提出確認も前回提出の削除完了を待つ。失敗時は確認画面と下書きを保持する。
- `tests/student-submission.test.mjs` は実際の画面コールバック・保存関数を架空の通信で実行する回帰テスト。修正前の保存待ちで入力が消える不具合を再現し、修正後の失敗・再試行・競合・二重操作・再読込失敗を確認した。
- ローカルの型チェックと本番ビルドは成功。既存テストの一部はWindowsのESMパス制約で動かないため、全体結果はLinuxのPR CIで確認する。CI・対象コミット・配備結果は対応PRに記録する。
- 差分はフロント・回帰テスト・この記録のみ。DB/Storage/Auth設定・既存データ・発行済みID/パスワードを変更する移行処理はない。本番利用者での提出試験は実施していない。

# リリース状況（2026-10-09 Storage復元確認追記）

## 最新の確認（2026-10-09）

- 本番539ファイルのバックアップ不足は解消。全件の本体SHA-256を照合。
- 非公開の試験用バケットへ全539件を復元し、内容・表示用メタデータを照合。PDF538件の先頭ページとWord1件の文書XMLを読取。
- 一括削除APIのHTTP 400を個別削除で解消し、試験用コピー・バケットの残存は0件。元バックアップと既存DB/Storageは不変。
- [実行の証拠・確認範囲](docs/storage-restore-2026-10-09.md)。Postgres全体・Auth・RLSの別DBへの復元、実ユーザーの学校間アクセスを含む復元演習、負荷試験は未実施。
- アプリの画面・API・DBスキーマは今回の差分で変更していない。

# 2026-10-02時点の確認（履歴）

日付付きの点検結果と確認範囲は [本番点検記録](docs/production-readiness.md) を参照してください。下部の過去の記録は現在の状態を表していません。

- 本番URL: https://explore.labtoimpact.com/
- main / Vercel Production、試験はstaging / Vercel Preview。接続先はsupabase-config.tsで選択する。VITE_LTI_ENVによる明示指定もあるため、環境変数を変更する場合は接続先を必ず確認する。
- 本番API: lti-accounts v9 / research-ai v30 / paper-search v6。新しい本番ドメインを許可し、認証・権限判定を維持。
- 論文535件にAI解析が保存済み。本番と試験環境のAI結果の照合値は一致。閲覧時には保存済み結果を表示する。
- 一括登録、研究入門、学校別機能制限、研究テーマの探索、運営メッセージ送信・受信箱、教員ごとのチェック対象による提出表示がソースに組み込まれている。全機能の実ログイン試験を今回再実施したわけではない。
- 学校IDは指定式。利用者の一括発行UIは最大1,000人、10人ずつの処理。本人パスワードは8文字以上、初回は現在のパスワード入力不要。
- 教員・生徒のMFA登録導線は廃止。運営MFAは必須。現時点で教員・生徒の検証済みMFA要素は0件。
- 本番Storage539件に対しバックアップ538件。課題添付1件が未収録。現在のStorageバックアップworkflowは手動実行のみ。
- Auth/SMTPの管理画面設定、実機のパスワード復旧、監視通知、全ファイルの復元演習は今回未確認。

## 記録を更新するとき

デプロイ前にREADME.md、docs/DATA_SAFETY.md、RELEASE_STATUS.md、docs/production-readiness.mdと対象機能のmdを読む。コード・配備・DBの各確認結果を分け、デプロイ後には対象コミット・関数バージョン・検証結果・未確認事項を記録する。過去の記録は日付を明示して残す。

## 過去の記録（作成日未記録）

School feature settings and optional author/abstract fields are ready. Publication-time AI source is staged but NOT DEPLOYED: automatic approval review rejected the external manuscript disclosure despite user permission. publish-research.ts currently only publishes; no AI is invoked by approval. The research-ai endpoint still runs its previous version; API-level feature restriction for teacher AI review awaits deployment. Password reset Site URL/Redirect URLs and recovery email template require Supabase dashboard configuration. Bulk registration and beginner lesson files were recovered locally and await integration.
