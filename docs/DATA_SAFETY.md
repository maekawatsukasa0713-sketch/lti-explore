# LTI Explore データ保護・リリース運用

## 環境分離

- 本番サイトだけが本番 Supabase `ozmulwqzybhiekmolvyk` を利用します。
- Vercel Preview、`staging` ブランチ、localhost は試験 Supabase `bvjjnzhhxieyxkeorurb` を利用します。
- 試験環境では画面上部に **STAGING / 試験環境** バナーを表示します。
- Preview URL で操作しても本番 DB / Storage には書き込みません。

## ファイル保存

論文、課題提出ファイル、課題配信の添付資料は Vercel 内ではなく Supabase Storage の `lti-documents` に保存します。
DB の各レコードには実ファイルの `storagePath` / `attachmentPath` を保存するため、通常の Vercel デプロイやアプリ更新ではファイルは削除されません。

## バックアップ

本番組織は Supabase Pro のため、Postgres DB は毎日自動バックアップされ、直近 7 日分を復元できます。
ただし Supabase の DB バックアップには Storage の実ファイル本体は含まれません。

Storage は GitHub Actions `.github/workflows/storage-backup.yml` で毎日 03:30 JST に、
本番 `lti-documents` から試験プロジェクト内の専用・非公開 `lti-production-backup` バケットへ追加コピーします。
本番で削除されたファイルをバックアップ側から削除しないため、誤削除への保険になります。

### GitHub Secrets に一度だけ登録する値

- `LTI_PROD_S3_ACCESS_KEY_ID`
- `LTI_PROD_S3_SECRET_ACCESS_KEY`
- `LTI_STAGING_S3_ACCESS_KEY_ID`
- `LTI_STAGING_S3_SECRET_ACCESS_KEY`

Secret 値はコードやチャットに貼らず GitHub Secrets のみに登録します。
未設定の場合、定期ワークフローは失敗せず「backup skipped」として終了します。

## リリース手順

1. feature ブランチで開発する。
2. Vercel Preview で試験する。Preview は自動的に試験 Supabase を使う。
3. ログイン、課題作成、ファイル添付、提出、PDF閲覧などを確認する。
4. CI が成功したら main にマージする。
5. main の production deployment が READY になったことを確認する。
6. Storage や DB の破壊的変更を伴う場合は、直前のバックアップ成功を確認してから実施する。
