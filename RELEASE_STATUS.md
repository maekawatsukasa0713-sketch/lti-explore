# リリース状況（2026-10-02確認）

現在の状態と確認の限界は [本番点検記録](docs/production-readiness.md) を参照してください。下部の過去の記録は現在の状態を表していません。

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
