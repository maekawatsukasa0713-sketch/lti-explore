# 本番の東京移行（2026-10-21）

## 現在の状態（2026-10-21 06:36 UTC）

**本番は東京へ切替済み。** https://explore.labtoimpact.com/ は `qzowxrmrxyjifoabjryr`（ap-northeast-1）へ接続する。
旧シンガポール `ozmulwqzybhiekmolvyk` は削除・停止せず、書込み停止状態で復旧用に保持する。
試験 `bvjjnzhhxieyxkeorurb` とPreviewの接続先は変更していない。

### 実行結果

| 項目 | 検証結果 |
| --- | --- |
| 非公開初回バックアップ | run `39550057024` 成功。prefix `39550057024-1/`、DB/config 9ファイルと実ファイル539件をread-back照合 |
| 初回DB/Storage復元 | run `39553210850` 成功。50アカウント、9校、584レコード、MFA2件、539ファイル（446,601,138 bytes） |
| DB同一性 | 9業務表全体、UUID/パスワードハッシュ、identities、発行済み学校/ログインID、MFA、所有者情報が一致 |
| スキーマ | 18ポリシー・36制約・既存27関数定義が一致。東京標準の `rls_auto_enable` は維持 |
| 実動作試験 | run `39554835759` 成功。3使い捨てユーザーのログイン/role、学校間アクセス制限、7MB超TUSアップロード/read-back、所有権、非公開backup拒否、学生の管理操作拒否、認証付きAI設定 |
| 検証後の後始末 | 試験ユーザー・学校・レコード・ファイルを削除し、元inventory一致を確認 |
| 最終書込み停止 | 旧本番の40業務/Auth/Storage表にstatement triggerを設置。3schemaでUPDATE拒否を実確認。プラットフォーム履歴/未使用Vector表は対象外 |
| 最終バックアップ | run `39555003848` 成功。prefix `39555003848-1/`。停止後のDB/認証/MFA/owner/policy一致と全539ファイルの両環境SHA256を再確認 |
| 本番切替 | PR #64、merge commit `80385c9501d6f2fe2589ee8f1f52bb2ef1fdbaf3` |
| 配備 | Vercel `dpl_9Eb7FoQ6nnh7qURrmuLGBwUV4Hkv`、production/READY、上記commit、本番カスタムドメインのalias反映確認 |
| 公開URL | HTTP 200、画面表示確認。配信JSに東京URL、CSPに東京HTTPS/Storage/WSS、旧本番ref除去、試験ref維持を実確認。保存済みレコード内の旧project URLは0件 |
| 通常Storageバックアップ | 東京をsourceにrun `39555678673` 成功。既存539件・446,601,138 bytesを照合、copied=0・failed=0 |

Auth設定、SMTP、セッション、Rate Limits、メールテンプレートは移行前記録に従って移設した。
ID再発行、パスワード変更、MFA解除は行っていない。プロジェクト切替後は再ログインが必要。
AIは認証付き設定確認までで、有料の実生成はこの移行試験に含めていない。
既存の認証器による実ユーザーMFA入力、メールの実受信、実ユーザーの全画面操作は未実施。

### 復旧時の注意

- 旧本番は書込み停止中。通常利用では本番サイトを再読み込みし、東京へ再ログインする。
- 東京に本番書込みが発生した後は、旧デプロイへの単純なrollbackをしない。まず東京の書込み停止、差分保全、再同期が必要。
- 切替前の停止解除用 `scripts/tokyo-source-unfreeze.sql` は当方のtrigger関数をno-opに戻す。切替後は差分再同期前に実行しない。
- 最終snapshotのschemaには旧環境だけの書込み停止関数/triggerが含まれる。稼働する東京へそのまま復元しない。
- 初回復元workflowは空DB専用。稼働中DBへ再実行しない。
- 通常backupは東京固定endpointと `MIGRATION_TARGET_S3_*` を使用。旧 `PROD_S3_*` は復旧用に保持し、試験 `TEST_S3_*` は維持。
- Supabaseの東京指定は、Vercel/CDN/ログ等を含む全通信・全データの日本国内限定を意味しない。

## 以下は移行準備時点の履歴

現在の状態は上記を優先し、以下の「未実施」「シンガポール本番」等は当時の記録として読む。

## 準備時点の状態

これは移行準備の記録。東京への復元・本番切替・旧環境の停止は未実施。
本番接続先は `ozmulwqzybhiekmolvyk`（`ap-southeast-1`）のまま。
本番データの書換え、アカウント再発行、本番切替はしていない。

### 東京環境の作成確認（2026-10-21、日本時間）

利用者が作成を完了し、管理APIで次を確認した。

- 名前：`lti-production-tokyo`
- project ref：`qzowxrmrxyjifoabjryr`
- 組織：`qogcpzxzbippiqfghnow`（既存の本番Pro組織）
- region：`ap-northeast-1`（東京）
- 状態：`ACTIVE_HEALTHY`
- 作成日時：2026-10-21 09:53:32 JST
- PostgreSQL：17.11.0.003（移行元は17.6.1.166。同じ17系で、論理移行前にCLI/pg_dumpの互換性を確認する）
- 読み取り点検：public/LTIテーブル0、Authユーザー0、Storageバケット/オブジェクト各0。
- 標準schemaと拡張は存在し、`supabase_migrations` schemaは未作成。

移行元も`ACTIVE_HEALTHY`。東京へのデータコピー・アカウント再発行・本番切替は未実施。
作業用ブラウザとコマンド実行環境には再接続済み。移行先を重複作成しない。

### 東京側の設定・関数準備（2026-10-21）

- Auth Site URLを `https://explore.labtoimpact.com/` に保存。
- Redirect URLsは移行元と同じ次の2件を保存・確認。
  - `https://lti-explore-six.vercel.app/?flow=recovery`
  - `https://explore.labtoimpact.com/?flow=recovery`
- 移行元と同じく新規自己登録を無効化。匿名ログイン・manual linkingは無効、メール確認は有効。
- メール認証の漏えいパスワード防止を有効化し、保存後の再表示で確認。
  その他のAuth設定・メールテンプレート・秘密設定の全体照合は未完了。
- `lti-accounts`、`paper-search`、`research-ai`を東京へ配備。すべてversion 1 / ACTIVE。
  再取得した全7ファイルは移行元と一致確認済みのリポジトリ内容と完全一致。
  `verify_jwt=false`と関数内での認証・権限検証を維持。
  各関数への未認証POSTはすべてHTTP 401。認証後の機能動作は未検証。
  DBとAIの秘密設定が未移設のため、配備成功をアプリの実動作成功とは扱わない。
- Supabase CLI 2.121.0の起動は確認。CLI認証、Docker/psql、移行先DB管理用接続情報が未準備。
  公式CLIの一時ログインロール経路は、移行元DB管理パスワードをリセットしない候補だが、未実接続。
  ダッシュボードのログインをCLI認証済みと扱わない。
- ローカルでの追加ツール導入はOS権限エラーで進められず、既存リポジトリのGitHub Actions上で
  公式ツールを実行する読み取り専用の移行前チェックを準備した。DB接続資格情報は未登録。
  この作業環境の制約を回避するために本番DBのパスワードや権限を変更しない。

東京へのDB/Storageコピーと本番切替は引き続き未実施。管理パスワードやAPIキーをチャットへ出さず、安全な接続経路を確保して続ける。

### 移行前チェックの接続準備

管理画面で確認済みのSession pooler（いずれもポート5432、DB名`postgres`）を使う。

| 対象 | ホスト | DBユーザー |
| --- | --- | --- |
| 移行元 | `aws-0-ap-southeast-1.pooler.supabase.com` | `postgres.ozmulwqzybhiekmolvyk` |
| 東京 | `aws-0-ap-northeast-1.pooler.supabase.com` | `postgres.qzowxrmrxyjifoabjryr` |

所有者が既存リポジトリのActions Secretsへ、`MIGRATION_SOURCE_DB_PASSWORD` と
`MIGRATION_TARGET_DB_PASSWORD` を直接登録する想定。これは学校・先生・生徒のログイン用ではなく、
各Supabaseプロジェクト作成時のDB管理パスワード。値をチャットへ送らない。
まだSecretの登録、移行前チェックの実行、バックアップの取得はしていない。
GitHubの管理者サインインは未確認で、現在のブラウザ認証の続行には利用アカウントの選択が必要。

`.github/workflows/tokyo-migration-preflight.yml` と `scripts/tokyo-migration-preflight.py` を追加。
手動実行・既存リポジトリのmain限定で、接続先は上表の2件に固定する。
両DBを読み取り専用で確認し、東京DBが空であることを確認してから、公式CLI 2.121.0で
移行元のroles/schema/dataを一時ファイルへ出力する。復元・配備・切替は含まない。
秘密設定を登録しただけでは実行されない。実行にはワークフローをmainへ反映する必要がある。
公開ログには集計値・成功失敗だけを出し、資格情報・ダンプ・エラー原文・個別レコードを出さない。
ダンプのartifactアップロードはなく、ジョブ終了時に消去するため、このチェックは保存済みバックアップの代わりではない。
ローカルでは構文と実行先・入力・非出力のガードを検証。実際の接続・dump成功は未確認。

2026-10-21 の読み取り点検：

| 対象 | 確認値 |
| --- | --- |
| 学校 | 9 |
| Authユーザー / 利用者プロフィール | 各50、参照不整合0 |
| アプリのレコード | 584 |
| 発行バッチ | 20 |
| Storage登録ファイル（メタデータ） | 539、446,601,138 bytes |
| 保存バケット | `lti-documents`、非公開 |
| publicのアプリテーブル | 9、すべてRLS有効 |
| public / storage のRLSポリシー | 18（件数は内容の同一性の証明ではない） |
| 稼働中のEdge Functions | `lti-accounts` v10、`paper-search` v6、`research-ai` v30 |

`scripts/migration-inventory.sql` を本番で実行できることを確認した。
publicの9テーブル全体を順序に依存しないSHA-256と件数で照合し、AuthのUUID集合、Storageのパスとサイズも比較する。
このSQLは読み取り専用で、個別レコード、パスワード、認証キー、MFA情報を出力しない。
Authのパスワード情報やStorageの実ファイル本体は、このSQLでは検証しない。

追加の `scripts/migration-auth-inventory.sql` も移行元で実行済み。
50件のパスワード情報は全件bcrypt形式で、Auth identities・プロフィールも各50件。
UUIDとパスワードハッシュの組、ログイン状態、identities、学校/ログインIDの紐づけを
集合のSHA-256で比較できる。紐づけ・孤立レコード・ログインメール生成規則の不整合は各0件。
個別のUUID、メール、ID、パスワードハッシュは返さない。日時はUTCへ正規化する。
これは移行元の基準値を作る検証であり、移行完了・MFAの移設・実際のログイン成功の証明ではない。
最終書込み停止後、移行先でログインする前に両環境で再実行し、全件数と全SHA-256の一致を必須とする。

利用者のMFA操作許可後、公式Auth実装の暗号化形式に基づき、MFAの保存形式を件数のみで確認した。
TOTPは2件ともBase32互換の既存形式で、Auth DBEncryption形式0件、空/未分類0件。
現在の2件では追加復号鍵が必要という障害は観測されなかった。
個別factor ID、秘密値、鍵、ハッシュは出力・保存しておらず、設定変更もしていない。
全Auth表のUUID/factor ID等を保持する論理移行後に、既存認証器での動作確認が必要。

## 実行前に必要なもの

- **東京の空の移行先**：`Northeast Asia (Tokyo)` / `ap-northeast-1` を明示選択する。
  APACの地域グループは選ばない。同じ地域へ戻す「Restore to a new project」は東京への移動に使わない。
- 現在のPro組織内に新設する場合は、既存環境と重なる期間のCompute料金が発生する。
  本番組織 `qogcpzxzbippiqfghnow` はProを契約済みで、再契約は不要。
  2026-10-21のコネクター見積りは新規プロジェクト月額10 USD相当。
  公式Micro単価は0.01344 USD/時間（時間単位計算）で、この料金を利用者へ説明済み。
  利用者は今回は料金の説明を条件に必要な課金を許可した。
  続いて「すすめて、二段階もいいよ」と管理画面での続行・必要な二段階認証も許可した。
  認証コードは専用の安全な入力経路で扱い、既存のMFAを無効化・リセット・再登録しない。
  当初の作成要求は2回とも接続側の `Invalid or expired requestState` で未完了。
  当時の一覧でも移行先はなく、追加プロジェクトの作成成功は確認できなかった。
  重複作成を避けるため同じ要求を繰り返さない。
  許可後に管理画面で `lti-production-tokyo`、Micro、`Northeast Asia (Tokyo)` を入力し、
  追加料金10 USD/月相当を確認。Data APIを有効、新テーブル自動公開を無効、自動RLSを有効にした作成フォームを準備した。
  フォーム準備時点では未作成だったが、その後利用者が管理パスワード設定・作成を完了した。最新状態は冒頭の作成確認を参照。
  復元時には元環境の明示的GRANT/RLSも引き継ぎ、APIアクセスを検証する。
- 既存のFree試験環境、復元用環境、停止中の環境を移行先として上書き・再開・削除しない。
- 移行元・移行先へ安全に接続できるDB接続情報または公式バックアップ復元経路。
  現在のローカル環境にはDB接続資格情報がなく、SQLの集計結果をバックアップの代用にしない。
  パスワード・秘密鍵・ダンプをチャット、Git、公開Actions artifactへ貼らない。
- 移行元・移行先のStorage資格情報、Edge Functionsの秘密設定の安全な移設経路。
- 切替時の書込み停止と、失敗時の戻し方を含む実施時間。

当初コネクターから確認できたのは本番Pro組織と既存本番プロジェクトのみ。東京環境の作成後は同じ組織内の2件を確認できた。
既知のFree試験プロジェクトにはアクセス権エラーが返った。削除や停止を意味するものではない。
Supabase管理画面には本番組織のアカウントで再接続済み。
日次バックアップはPhysical形式で、最新は2026-10-20 20:55:40 UTC。
この画面のRestoreは移行元の復元であり、実行していない。
異なる地域へ移す論理バックアップの代用として、このPhysicalバックアップを扱わない。

## 移す対象と維持するもの

1. **PostgresとAuth**：公式の論理バックアップ・復元手順に沿って、public、Auth、権限、RLS、関数、トリガー、拡張、採番を移す。
   学校ID、利用者UUID、ログインID、パスワードハッシュ、Auth identities、発行バッチを維持する。
   `lti_schools` の既存の機能設定を維持し、利用者の再発行やAI解析の再生成はしない。
   Authの既存署名・暗号化情報の移設要否は公式手順で確認する。既存MFAの解除・リセット・再登録はしない。
   必要なログイン時のMFA入力は、利用者が安全な専用入力経路で行う。MFA関連データを除外して強行しない。
2. **Storage**：DBバックアップと別に、実ファイル全件を同じバケット名・キーでコピーし、各本体のSHA-256、サイズ、表示用メタデータを照合する。
   Storageのowner/owner_idもRLSに関係するため、公式移行手順に従って保存・照合する。
   このPRのバックアップスクリプトだけで、新本番へのファイル所有権まで復元できるとは扱わない。
3. **設定と関数**：AuthのSite URL、Redirect URLs、メール/SMTP/OAuthの既存設定、Storageの非公開設定・制限、Realtime、3本のEdge Functionsを移す。
   関数内の標準Supabase変数は新環境のものを使う。`ANTHROPIC_API_KEY`等の既存秘密設定は安全な経路で移設する。
   古いコードを再配備しないよう、稼働中の関数とリポジトリの内容を比較してから移す。
   2026-10-21の比較では本番3関数の全7ソースファイルがリポジトリと完全一致した。
   3関数は `verify_jwt=false` で、旧プロジェクトrefのハードコードはない。
   `ANTHROPIC_API_KEY` と設定している場合の `ANTHROPIC_MODEL` は別途安全な移設が必要。
   この比較では秘密値の取得、再配備、環境設定の変更は行っていない。

## 接続先の切替箇所

| 箇所 | 東京移行時の変更 |
| --- | --- |
| `supabase-config.ts` | 本番URLと本番publishable keyを新プロジェクトへ。試験URL/keyと環境判定は維持 |
| `vercel.json` | 新本番のHTTPSホスト、`.storage.supabase.co`ホスト、WSSホストをCSPに明示。既存試験ホストは維持 |
| `tests/admin-paper-library.test.mjs` | 本番refを確認する期待値を新refへ |
| GitHub Actions Variables | `PROD_S3_ENDPOINT`を新本番S3 endpoint、`PROD_AWS_REGION=ap-northeast-1` |
| GitHub Actions Secrets | `PROD_S3_ACCESS_KEY_ID` / `PROD_S3_SECRET_ACCESS_KEY`を新本番のものへ |
| バックアップ先 | 既存Free試験のendpoint / `TEST_S3_*` / `TEST_AWS_REGION=ap-southeast-1`を維持 |
| `docs/DATA_SAFETY.md` | 実際の切替完了後に現行本番情報を更新。日付付き過去記録は書き換えない |

この準備PRはバックアップの本番・試験region指定を分離するだけで、現在の本番・試験接続先を変更しない。
Variables未設定では現行シンガポールの接続先が使われる。
本番用のendpoint、region、資格情報は同じ対象の組として設定する。

`client.ts`、`document-upload.ts`、PDF閲覧は設定から接続先を導く。
通常アップロードに加え、6MB超ファイルのTUSアップロードとPDF表示も実際に確認する。
通常のVercel Previewは既存のFree試験へ接続したままにし、`VITE_LTI_ENV=production`で誤って本番へ接続させない。
東京環境への動作試験は対象を明示した限定的な検証経路で行う。

## 切替・検証・戻し方

1. 最初のコピーと試験を東京環境で行う。旧本番は維持する。
2. 最終切替時は旧本番への書込みを止め、差分を含む最終DBバックアップとStorage照合を取得する。
   2026-10-21の件数は固定の期待値ではなく準備時点の値であり、切替直前の値を使う。
3. 同じ停止時点の移行元・移行先で両inventory SQLを比較する。Auth比較は移行先ログインより前に行う。
   別途Authの復元、DBスキーマ/ポリシー/関数の内容、全ファイル本体と所有者を検証する。
4. 先生・生徒のログイン、学校間のアクセス制限、既存の機能選択、PDF閲覧、課題添付、提出、関数呼出し、バックアップを検証する。
   本物の教師アカウントや画像中のパスワードを無断で使わず、検証用アカウントで行う。
5. 検証済みの接続先を本番へ反映する。プロジェクトが変わるため、利用者には再ログインが必要になり得る。
6. 東京へ新規書込みが始まる前なら、旧デプロイ・旧設定へ戻せる。
   東京へ新規書込みが発生した後は、単に旧本番へ戻すと新規データが欠落するため、書込み停止・差分保全・再同期を先に行う。
7. 移行完了と保存を確認するまで旧本番を削除しない。停止・整理は費用と復旧可能性を確認して別途実施する。

学校のフィルター担当には切替後の新しいAuth/DataホストとStorageホストを伝える。
保存地域の変更だけで県側のフィルターが解除されるわけではない。
東京を選んでもログ・CDN・サポート等を含む全情報の国内限定が保証されるわけではない。

## 公式資料

- [利用可能な地域](https://supabase.com/docs/guides/platform/regions)
- [地域変更](https://supabase.com/docs/guides/troubleshooting/change-project-region-eWJo5Z)
- [CLIによるバックアップ・復元](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore)
- [Authユーザーの移行](https://supabase.com/docs/guides/troubleshooting/migrating-auth-users-between-projects)
- [データの保存地域と移転](https://supabase.com/legal/privacy-resources/data-residency-and-transfers-faq)
- [Compute料金](https://supabase.com/docs/guides/platform/manage-your-usage/compute)
