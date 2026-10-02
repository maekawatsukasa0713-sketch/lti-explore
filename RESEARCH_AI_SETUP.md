# AIの構成と保存（2026-10-02確認）

本番research-ai v30がACTIVE。論文535件すべてにAI解析が保存済みで、本番・試験のAI結果の照合値が一致しています。

## 論文の登録解析

- 登録済みの原稿を運営が解析すると、aiAnalysisとaiStateを論文レコードに保存する。
- 保存済み解析があれば再利用する。閲覧や公開操作だけでは生成APIを再実行しない。
- 解析はサーバーで処理を続け、受け付け時に202を返す。202は完了の証明ではなく、保存済みの結果とready状態を確認する。
- 処理中の重複依頼を拒否し、失敗分は運営の明示操作で再解析できる。運営の既存結果編集は新規生成ではない。古い結果に評価項目がない場合の補完は追加呼び出しになり得る。
- 解析と公開は別操作。公開前・公開後に運営が要約・継続提案・分類等を編集できる。
- 一括解析の現在の同時実行数はresearch-batch.tsの5件。

## AI添削

教員・運営向け。現在は分割・再開処理があり、教員が送信する前の添削結果は画面側に保持される。同一入力の成功結果は関数インスタンス内でユーザー単位・最長1時間のキャッシュを使う。論文登録時の永続保存とは区別する。

## 認証・鍵・利用枠

関数内でJWTをAuthへ確認し、利用中のプロフィール・役割・学校別機能を判定するため、verify_jwt=falseで配備している。
ANTHROPIC_API_KEYはSupabase Edge Function Secretsにだけ保存する。ANTHROPIC_MODELは任意で、ソースの既定はclaude-haiku-4-5-20251001。
SUPABASE_SERVICE_ROLE_KEYはサーバー内で失敗時の利用枠払い戻しに使う。フロントやGitHubへ鍵の値を入れない。

利用枠はDBのRPCで管理する。現在の登録解析は利用者あたり300件/時・全体3,000件/日、添削は20件/時・全体200件/日。回数の制限であり、金額の上限ではない。提供元側の課金上限も別途必要。

## 原稿

8MBを超えるPDFはフロントで本文を抽出して送る。小さいPDFはdocumentブロック、DOCXは本文テキストで、Wordの図表・画像は含まれない。抽出文字数やAPIペイロードにも上限がある。保存可能なファイルサイズとAIへ直接送信できるサイズは同一ではない。

今回、新たな課金を伴うモデル生成や実アカウントの添削試験は実施していない。状態の確認には保存済みデータ・配備コード・権限を使用した。

---

# 過去のセットアップ記録（作成日未記録）

以下の「DBへ保存しない」「サービス秘密鍵を使わない」「インスタンス内制限のみ」等は当時の構成であり、現在の設定指示ではありません。

# Research screens and AI connection

The public library uses existing `papers` records with status `公開中`. Cards and field counts never seed example papers, views, or likes. The PDF/Word reader uses the authenticated user's existing Storage permissions.

`research-ai` is an authenticated Supabase Edge Function. It validates JWTs through Supabase Auth, checks that the profile is active, and limits `review` to teachers/admins. `verify_jwt=false` is intentional because authentication is performed inside the handler, including the profile check. It does not use the service-role key and does not change RLS or the database schema.

Configure `ANTHROPIC_API_KEY` in the Supabase project's Edge Function Secrets. Do not put this key in GitHub, frontend files, Vite variables, or chat. `ANTHROPIC_MODEL` is optional; the default is `claude-haiku-4-5-20251001`. The configured API account must support this model and have available usage. The authenticated `status` operation returns only a configuration boolean, never a credential.

Requests send the selected manuscript to Anthropic. DOCX is extracted to text in the browser; images and diagrams inside Word are not included. PDF is sent as a document block. Limits are 8 MB/file and 80,000 extracted characters. Password-protected PDFs, very long PDFs, unreadable scans, and provider errors return a visible error instead of fabricated results. If no file exists, the registered abstract can be analyzed and is clearly labeled as abstract-only.

Identical successful requests are cached by authenticated user and input hash for up to one hour in the current function instance. Explicit regeneration bypasses the cache. Results are not written to a shared database. Draft reviews stay in React memory until the teacher sends feedback through the existing workflow. The per-instance hourly throttle is best effort, not a global billing quota; configure provider-level usage limits for production.

Validation performed: production TypeScript/Vite build; SSR for published-only cards and three review panels; mocked function tests for missing auth, inactive accounts, student review denial, missing key, malformed input/output, and cached requests. A live model response and authenticated browser flow still need verification with the configured API account.
