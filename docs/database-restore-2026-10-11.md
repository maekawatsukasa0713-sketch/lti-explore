# DBバックアップ復元の実証（2026-10-11、日本時間）

## 結果

利用者が本番プロジェクトの「Restore to new project」で作成した専用DBに接続し、データ・スキーマ・権限・読み取りのアクセス制限を検証した。比較対象39テーブルの件数と全行の照合値が本番と一致し、46項目のSQL権限検証も成功した。

これはPostgres DBの復元確認であり、新プロジェクトをアプリの完全な復旧先として構成したという判定ではない。Storageの実ファイル、Edge Functions、Authサービス設定は別途復旧が必要。実ファイル539件の復元・内容照合は[2026-10-09の別の演習](storage-restore-2026-10-09.md)で実施済み。

## 対象・時間

| 対象 | プロジェクト | 状態 |
| --- | --- | --- |
| 本番 | `ozmulwqzybhiekmolvyk` | ACTIVE_HEALTHY |
| 既存の試験環境 | `bvjjnzhhxieyxkeorurb` | ACTIVE_HEALTHY、保持 |
| 今回の復元先 | `zzaljxqectngziawxakn` / `lti-restore-test-20261011` | ACTIVE_HEALTHY |

- 利用者の画像で、復元元が本番の「Restore to new project」であること、新しい復元先名とRESTORING表示を確認。
- 復元先の作成日時は2026-10-11 14:38:13 JST。2026-10-11 14:44:02 JSTには新DBに接続して照合結果を取得できた。開始から6分以内の接続確認であり、アプリ全体の復旧時間を示さない。
- 本番の照合値は14:40:32〜14:40:35 JST、復元先は14:44:02〜14:44:03 JSTに取得。最後に本番・既存試験・復元先を14:48:52〜14:48:56 JSTに再確認した。
- 復元元画面で案内した最新バックアップ表示は2026-10-10 20:53:35 UTC（10/11 05:53:35 JST）。選択されたバックアップ時刻や管理画面履歴の最終COMPLETED表示を、接続APIで独立取得したものではない。管理画面の再確認はサインイン画面への移動で終了し、ログイン操作は行わなかった。
- 完了の根拠は接続APIのACTIVE_HEALTHYと、新DBへの実際のSQL接続・データ照合。単に作成ボタンを押したことを成功の根拠としていない。

## データ照合

| publicテーブル | 件数 | 本番との件数・内容 |
| --- | --- | --- |
| lti_ai_usage | 1 | 一致 |
| lti_paper_bookmarks | 1 | 一致 |
| lti_paper_citations | 1 | 一致 |
| lti_paper_views | 19 | 一致 |
| lti_profiles | 40 | 一致 |
| lti_provision_batches | 18 | 一致 |
| lti_records | 584 | 一致 |
| lti_schools | 8 | 一致 |
| lti_support_messages | 0 | 一致 |

- `lti_records`584件には論文535件と保存済みAI解析535件を含む。公開中534件、公開停止1件。AIの再生成は行っていない。
- Authユーザー40件・認証ID40件も一致。ユーザー行と保存済みパスワードハッシュを含むデータをDB内で集計し、件数と照合値だけを取得した。パスワード、メールアドレス、セッションID、トークン、実際の行データを公開文書やログへ出していない。
- 照合対象はpublic 9、auth 20、storage 8、supabase_migrations 1、vault 1の計39テーブル。移行履歴とVaultの空テーブルも一致。
- authのMFA/WebAuthn関連テーブルに対する直接照合は今回の対象から除外した。realtimeなど他の管理用スキーマ全体の照合は行っていない。
- 各行を`to_jsonb`へ変換し、行ごとのMD5を並べ替えて集計MD5を計算した。空テーブルを含め、件数と多重集合としての内容を比較した。件数だけの一致ではない。
- 論文・AI解析を含む`lti_records`全JSONのID順照合値は、本番・復元先とも`8f65cbdf04e7679d6ba3368940588d0f`。

## スキーマ・権限

| 項目 | 復元先の結果 |
| --- | --- |
| アプリ用テーブル・列・既定値 | 本番と一致 |
| RLS | publicの9テーブルすべて有効。本番と同じ設定 |
| インデックス | 19個、定義一致。無効・準備未完了0個 |
| 制約 | 36個、定義一致。外部キー11個、未検証0個 |
| ポリシー | public/storageの18個、定義一致 |
| public関数 | 27個、定義一致 |
| トリガー | publicの6個とAuthユーザー作成の1個、定義・有効状態一致 |
| 関数の所有者・実行権限・search_path・SECURITY DEFINER属性 | 27関数で本番と一致 |
| DBロール・ロール所属・publicテーブル権限 | 本番と一致 |
| publicシーケンス | 定義・現在値一致。採番を進める操作は未実施 |
| 拡張機能 | 5個、名称・バージョン一致 |
| 外部処理を実行する拡張 | pg_cron/pg_net/wrappers/pgmq/pglogicalの有効化なし |
| PostgreSQL | 本番17.6、復元先17.11。エンジンのバージョンは異なる |

列・既定値の照合値：`c11181ea472fdc15bb7d331d1fae7923`。publicの制約・インデックス・関数・トリガーとpublic/storageのポリシーを合わせた定義照合値：`6673cc511187d495f7bf014317e75eda`。すべてDB内で計算した比較値であり、バックアップファイルそのものではない。

## SQLによる閲覧権限の試験

[実行した読み取り検証SQL](../scripts/verify-restored-db-read.sql)を記録した。復元先だけを指定し、各試験をREAD ONLYトランザクションで実行してROLLBACKした。新しいテストアカウントやレコードは作成していない。

SQL内の一時的なリクエスト条件で、復元済みの生徒・教員とセッションに対応する閲覧権限を確認した。AuthへログインするリクエストやJWTの発行は行っていない。

| ケース | 確認した挙動 | 結果 |
| --- | --- | --- |
| 生徒 | 自校だけを参照。同校の有効な教員と本人のプロフィールを参照。公開論文534件と保存済みAI解析534件を読取。公開停止論文・他校の非公開レコード・他生徒の提出物等を拒否 | 13項目成功 |
| 教員 | 自校の学校・プロフィールだけを参照。公開論文534件と保存済みAI解析534件を読取。他校の非公開レコード・他校の未公開論文を拒否 | 12項目成功 |
| 利用停止、初回パスワード変更前、存在しないアカウント | アプリ用の役割を取得できず、論文等と学校を参照できない。本人プロフィールの既存の参照条件も確認 | 12項目成功 |
| 匿名 | publicの9テーブルへのSELECTを権限不足として拒否 | 9項目成功 |

合計46項目成功。INSERT/UPDATE/DELETEの実行、書き込みRPC、メール送信、実ブラウザのログイン、二段階認証、パスワード変更は試験していない。書き込みポリシー等は定義の一致を確認した範囲である。

## 保持の確認

検証前後の39テーブルの件数・全行照合値は、本番・既存試験・復元先の各環境でそれぞれ一致した。本番と試験は意図的に異なるデータを持ち、今回の復元先で既存試験を上書きしていない。

- 本番：`lti_records`584件、論文535件、保存済みAI解析535件、Storageメタデータ539件。
- 既存試験：`lti_records`558件、論文535件、保存済みAI解析535件。`lti-documents`538件と`lti-production-backup`539件を保持。
- 復元先：`lti_records`584件。検証用の新規行や一時コピーは残していない。今回のSQL検証はデータへの書き込みを伴わない。

復元用プロジェクトは利用者が作成し、そのまま保持している。決済関連、プロジェクトの削除・停止、二段階認証の操作は行っていない。本番アプリの接続先・コード・Auth設定も変更していない。

## 新プロジェクトで残る復旧項目

1. **Storage実ファイル**：storage.objectsの539件は復元されたDBメタデータ。新プロジェクトへのファイル本体の転送・ダウンロード確認は未実施。メタデータが存在することを実ファイルの復元成功とみなさない。
2. **Edge Functions**：本番はlti-accounts v10 / paper-search v6 / research-ai v30の3個がACTIVE。復元先は0個で、再配備が必要。
3. **Auth等のサービス設定**：Auth設定・APIキー、SMTP/URL設定、Realtime設定等の再構成は未実施。DBユーザー行が一致しても、そのまま本番ログインを再開できるという判定ではない。
4. **実アプリの切替え試験**：新しいプロジェクトへフロントを接続した完全な利用者操作の試験は未実施。現在の本番・Previewの接続先は変更していない。

[Supabaseの復元機能の説明](https://supabase.com/docs/guides/platform/clone-project)にも、DBの転送対象と、Storage・Edge Functions・Auth設定などの手動再構成項目が記載されている。

## Security Advisor

本番と復元先はERROR 0件。既存のSECURITY DEFINERのWARN 13件、RLS有効・直接ポリシーなしのINFO 5件は同じ。これらを消すために権限やポリシーを変更していない。

復元先には、漏洩パスワード保護が無効のWARN 1件、MFAの有効な選択肢不足のWARN 1件が追加で出ている。サービス設定は本番の設定を再構成していない状態。今回、二段階認証の設定・認証操作は行っていない。

- [SECURITY DEFINERの確認事項](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)
- [RLS有効・ポリシーなし](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy)
- [漏洩パスワード保護](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)
- [MFA設定の説明](https://supabase.com/docs/guides/auth/auth-mfa)
