# LTI Explore データ保護・リリース運用

## 環境分離

- 本番URLは https://explore.labtoimpact.com/ 。supabase-config.tsの本番ホスト一覧またはVITE_LTI_ENVの明示指定で接続先を選びます。
- 本番サイトは本番 Supabase `ozmulwqzybhiekmolvyk` を利用します。
- Vercel Preview、`staging` ブランチ、localhost は、VITE_LTI_ENVの上書きがない場合、試験 Supabase `bvjjnzhhxieyxkeorurb` を利用します。
- 試験環境では画面上部に **STAGING / 試験環境** バナーを表示します。
- Previewの環境変数を変更するときは、本番接続を明示するVITE_LTI_ENV=productionが入っていないことも確認します。

## ファイル保存

論文、課題提出ファイル、課題配信の添付資料は Vercel 内ではなく Supabase Storage の `lti-documents` に保存します。
DB の各レコードには実ファイルの `storagePath` / `attachmentPath` / `brochurePath` を保存するため、通常の Vercel デプロイやアプリ更新ではファイルは削除されません。

## バックアップ

本番組織は Supabase Pro のため、Postgres DB は毎日自動バックアップされ、直近 7 日分を復元できます。
ただし Supabase の DB バックアップには Storage の実ファイル本体は含まれません。

StorageはGitHub Actions `.github/workflows/storage-backup.yml` を手動実行し、本番 `lti-documents` から試験プロジェクト内の専用・非公開 `lti-production-backup` バケットへ追加コピーします。
現行workflowはworkflow_dispatchのみで、定期scheduleはありません。以前の「毎日03:30 JST」の記載は実装と一致していませんでした。
本番で削除されたファイルをバックアップ側から削除しないため、誤削除への保険になります。

### GitHub Secrets に一度だけ登録する値

- `PROD_S3_ACCESS_KEY_ID`
- `PROD_S3_SECRET_ACCESS_KEY`
- `TEST_S3_ACCESS_KEY_ID`
- `TEST_S3_SECRET_ACCESS_KEY`

Secret 値はコードやチャットに貼らず GitHub Secrets のみに登録します。
未設定の場合、手動ワークフローは失敗終了します。元・既存バックアップ・コピー後の実ファイルをSHA-256で照合し、同サイズでも内容が異なればコピーします。認証・通信・照合の失敗もジョブを失敗させます。集計のfailedが0であることと不足件数を確認してください。全本体の読取はダウンロード通信を伴います。

### 2026-10-02の読み取り点検

バックアップ538件は本番とファイル名・サイズ・ETagが一致。本番は539件で、後から追加された課題添付1件（4,779,323バイト）が未収録です。論文535件の添付参照先は本番・試験とも存在しています。ETag照合は全ファイル本体の独立したチェックサム検証ではありません。
詳細は [本番点検記録](production-readiness.md) に記録しています。

## リリース手順

1. feature ブランチで開発する。
2. Vercel Preview で試験する。Preview は自動的に試験 Supabase を使う。
3. ログイン、課題作成、ファイル添付、提出、PDF閲覧などを確認する。
4. CI が成功したら main にマージする。
5. main の production deployment が READY になったことを確認する。
6. Storage や DB の破壊的変更を伴う場合は、直前のバックアップ成功を確認してから実施する。

## 2026-10-07の修正・再点検

添付権限の本番修正後も論文535件・保存済みAI解析535件と全レコードの内容が前回と一致しました。バックアップ不足の課題添付1件は残り、新しいworkflowの実行と復元演習は未実施です。[詳細な点検記録](audit-2026-10-07.md)を参照してください。

本番の再設定メールの移動先は `https://explore.labtoimpact.com/?flow=recovery` にします。旧Vercel URLの配備保護によるログイン画面への移動を避け、試験環境では試験URLに留めます。Auth側のSite URL・Redirect URLsと実際のメール復旧は別途確認が必要です。

## 2026-10-09の実ファイル照合

GitHub Actions Storageバックアップ実行 #3（run 37883820877）は、既存538件・441,821,815バイトの本体をSHA-256で照合しました。新規コピー0件・失敗1件で終了しており、完全なバックアップ成功ではありません。4,779,323バイトの課題添付1件が引き続き未収録です。エラー種別ClientErrorだけでは原因は確定できません。

再実行時は失敗段階・HTTPステータス・S3エラーコード・対象キーのSHA-256を出力します。認証情報や例外メッセージ・元ファイル名はログに出しません。照合や権限の条件は緩和していません。修正後の新しいmainをRun workflowで実行してください。Re-run jobsは元のコミットを使うため修正を取り込みません。
