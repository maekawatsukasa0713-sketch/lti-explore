# 本番の東京移行準備（2026-10-21）

## 現在の状態

これは移行準備の記録。東京への復元・本番切替・旧環境の停止は未実施。
本番接続先は `ozmulwqzybhiekmolvyk`（`ap-southeast-1`）のまま。
本番データの書換え、アカウント再発行、決済、二段階認証の操作はしていない。

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

## 実行前に必要なもの

- **東京の空の移行先**：`Northeast Asia (Tokyo)` / `ap-northeast-1` を明示選択する。
  APACの地域グループは選ばない。同じ地域へ戻す「Restore to a new project」は東京への移動に使わない。
- 現在のPro組織内に新設する場合は、既存環境と重なる期間のCompute料金が発生する。
  本番組織 `qogcpzxzbippiqfghnow` はProを契約済みで、再契約は不要。
  2026-10-21のコネクター見積りは新規プロジェクト月額10 USD相当。
  公式Micro単価は0.01344 USD/時間（時間単位計算）で、この料金を利用者へ説明済み。
  利用者は今回は料金の説明を条件に必要な課金を許可した。二段階認証の操作禁止は継続。
  作成要求は2回とも接続側の `Invalid or expired requestState` で未完了。
  その後の一覧でも移行先はなく、追加プロジェクトの作成成功は確認されていない。
  重複作成を避けるため同じ要求を繰り返さない。
- 既存のFree試験環境、復元用環境、停止中の環境を移行先として上書き・再開・削除しない。
- 移行元・移行先へ安全に接続できるDB接続情報または公式バックアップ復元経路。
  現在のローカル環境にはDB接続資格情報がなく、SQLの集計結果をバックアップの代用にしない。
  パスワード・秘密鍵・ダンプをチャット、Git、公開Actions artifactへ貼らない。
- 移行元・移行先のStorage資格情報、Edge Functionsの秘密設定の安全な移設経路。
- 切替時の書込み停止と、失敗時の戻し方を含む実施時間。

2026-10-21時点でコネクターから確認できたのは本番Pro組織と本番プロジェクトのみ。
既知のFree試験プロジェクトにはアクセス権エラーが返った。削除や停止を意味するものではない。
Supabase管理画面には本番組織のアカウントで再接続済み。
日次バックアップはPhysical形式で、最新は2026-10-20 20:55:40 UTC。
この画面のRestoreは移行元の復元であり、実行していない。
異なる地域へ移す論理バックアップの代用として、このPhysicalバックアップを扱わない。

## 移す対象と維持するもの

1. **PostgresとAuth**：公式の論理バックアップ・復元手順に沿って、public、Auth、権限、RLS、関数、トリガー、拡張、採番を移す。
   学校ID、利用者UUID、ログインID、パスワードハッシュ、Auth identities、発行バッチを維持する。
   `lti_schools` の既存の機能設定を維持し、利用者の再発行やAI解析の再生成はしない。
   Authの既存署名・暗号化情報の移設要否は公式手順で確認する。MFAの解除・再登録・コード入力はエージェントが行わない。
   MFAに関する手動操作が必要な場合は所有者へ引き継ぐ。MFA関連データを除外して強行しない。
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
