# Storageの世代バックアップと復元確認

添付ファイルを自動バックアップしても、不具合で壊れた新しい内容だけを残さないための方式です。新しい内容は別オブジェクトへ追加し、過去の良好な版・本番で削除された版・従来の同名バックアップを削除しません。発行済みID、パスワード、DBレコード、本番ファイルを変更する処理はありません。

## 実行と通知

- `Backup production Storage` は毎日03:30（日本時間、cron `30 18 * * *`）に実行します。GitHub側の混雑で開始が遅れる場合があります。mainからの手動実行も可能です。
- バックアップコードまたはworkflowのmainへの変更時にも1回実行し、そのrunでは新snapshotを隔離バケットへ復元・照合・片付けする検証を続けます。毎日のバックアップのたびに全復元する構成ではありません。
- sourceは東京本番 `qzowxrmrxyjifoabjryr` の `lti-documents`、保存先は既存の試験環境 `bvjjnzhhxieyxkeorurb` の非公開 `lti-production-backup`。現在のGitHub Secretsを継続利用し、新たな秘密値は追加しません。
- backupとrestoreのworkflowは同じconcurrency groupを使い、互いに同時実行せず、実行中の処理もキャンセルしません。
- 失敗はジョブ失敗・error annotation・ジョブsummaryに表示します。メール／Web通知はGitHub標準のActions通知を使うため、運営担当者の通知先と通知設定に依存します。個人のメール設定や実際のメール到達は、この実装だけでは確認できません。
- 成功はログの `completed: true`、`failed: 0` とworkflowの成功で確認し、summaryに表示する `github-<run_id>-<run_attempt>` を復元ポイントとして記録します。失敗したrunのIDを復元可能と扱わないでください。

## 保存形式と完了条件

非公開バックアップバケット内の構成は次のとおりです。

```text
<以前の元ファイルキー>                       従来のバックアップ。上書き・削除しない
.lti-snapshots/v1/objects/<SHA-256>            内容ごとの不変オブジェクト
.lti-snapshots/v1/snapshots/<ID>/manifest.json 元キー・サイズ・SHA・表示メタデータ
.lti-snapshots/v1/snapshots/<ID>/COMPLETED.json manifestのSHAを持つ完了マーカー
```

元ファイルの本体をSHA-256で確認し、同じ内容が既にあれば保存先の本体も読み直して照合します。新しい内容だけを追加し、アップロード後に再読取します。既存のSHAキーの内容が一致しない場合は、そのオブジェクトを上書きせずに失敗します。表示用のContent-Type、Content-Disposition、Cache-Control、ユーザーメタデータはmanifestに記録するため、同じ内容でも元キーごとの表示設定を復元できます。

すべての本体を照合し、処理前後のsource一覧（キー・サイズ・ETag）が一致した後、manifestを書いてread-back照合します。その後だけ完了マーカーを追加します。復元処理は完了マーカーとmanifestのSHA一致・構造・全件数を確認し、未完了・破損したmanifestを受け付けません。途中で停止したrunの未参照blobやmanifestは残ることがありますが、完成世代として扱いません。

同じsnapshot IDのmanifestまたは完了マーカーが既にあれば、上書きを拒否します。再実行は新しいrun_attemptのIDを使い、検証済みblobを再利用します。sourceが0件なら異常とみなして失敗し、過去のバックアップを保持します。sourceでの削除は古い世代へ追随しません。

## 容量・保持方針

**全世代を期限なく保持し、自動削除・世代削減・未参照blobの回収は行いません。** 初回は従来の同名バックアップを残したまま、現状の全内容を新形式にも保存します。その後の容量増は主に「変更された内容＋小さなmanifest／マーカー」です。同じ内容の毎日の複製は作りません。

本体の照合には毎回、sourceと保存済みblobの読取通信が発生します。容量・転送・APIリクエストには利用料金やプラン制限があり、無料で増え続ける方式ではありません。将来、保持年限や削除を導入する場合は、復元確認済み世代・障害前の良好な世代を守る別の運用判断が必要です。

この実装はS3のversioningやconditional PUTに依存しません。同じIDを別プロセスから同時に発行する運用は非対応です。workflowの共通concurrencyと一意のrun IDを維持し、手作業で同じIDを並列指定しないでください。

## 指定世代の隔離復元

`Verify private Storage restore` をmainから実行します。

1. `snapshot_id` に成功したrunのIDを指定します。
2. `expected_files` は空欄ならmanifestの件数を使います。値を入力した場合はその件数との一致も必須です。
3. スクリプトは試験環境に新規作成した `lti-restore-check-<run>-<attempt>` だけへ、当時の元ファイルキー・内容・表示メタデータを復元します。本番への書戻しはしません。
4. 全本体のSHA・サイズ・メタデータ、非公開アクセス、PDF先頭ページ／Word XMLの読取を確認します。結果にある `failed` と `view_failed` が0、`restored` が `expected` と一致し、`backup_unchanged` と `cleanup_success` がtrueであることを確認します。
5. 成功・失敗のどちらでも、そのrunが新規作成した専用バケットと一時コピーだけを片付けます。元バックアップは変更しません。以前から存在する宛先には上書き・削除しません。

`encrypted_pdf` は暗号化PDFを識別してページ情報を取得した件数で、パスワード入力・復号・本文描画の成功を意味しません。`docx_opened` は必要なZIP内XMLの構造を開けた件数で、Wordの全レイアウト再現を保証しません。全ファイルのバイト照合と、文書形式ごとの閲覧検査は分けて評価します。

`snapshot_id` を空欄にすると従来の同名バックアップを復元します。この場合、新snapshot用prefixを除外し、`expected_files` 空欄時は従来の539件を期待値にします。legacyは世代方式導入後に更新しないため、新しい提出物の復旧には成功したsnapshot IDを指定してください。

後片付けが中断された場合の `CLEANUP_ONLY_RUN_ID` / `CLEANUP_ONLY_RUN_ATTEMPT` モードは、専用namespace、件数、キー・サイズだけでなく実際のSHAが選択世代と一致した場合だけ削除します。snapshot復元の後片付けでは同じ `RESTORE_SNAPSHOT_ID` を指定します。違う内容が残っていれば削除を拒否します。

## 失敗したとき

失敗ログは処理段階、例外クラス、安全なHTTPコード、元キーのハッシュだけを出します。資格情報、原稿本文、ファイル名の一覧、manifest本体をActions artifactや公開ログへ出しません。

失敗原因を解消してworkflowを再実行してください。新しいIDで途中まで保存された正常blobを利用できます。既存blobのSHA不一致が報告された場合は自動修復・上書きをしません。保存先の障害や破損を切り分け、過去世代を維持した復旧方法を個別に決めます。失敗を隠すために検証や非公開設定を外さないでください。

## 確認範囲と限界

新方式の自動試験は、同名変更、削除、全0件、部分失敗、再試行、sourceの途中変更、重複ID、既存blob・manifest・完了マーカーの破損、指定旧世代の復元、legacy互換、復旧cleanupの内容不一致を、通信しないメモリ内S3で再現しています。Windowsでも実行できる形でバックアップ31件・復元25件の試験を通しています。実Storageでの初回実行と復元成功は、実際のworkflow結果で別途確認します。

これはStorageの単一時点をトランザクションで凍結する機能ではありません。各ファイルと処理前後一覧の変化を検出しますが、稼働中のDBとStorage全体を原子的に同時取得したsnapshotではなく、一時的に変更して元へ戻ったケースまで保証しません。厳密な復旧ポイントを作る場合は、計画した書込停止とDBバックアップとの対応付けが必要です。

バックアップは内容の意味が正しいかを判断しません。不具合で壊れた内容も新しい世代として保存し得ますが、それにより既存の良好な世代を消しません。Postgres／Auth／RLSの復元は別の手順です。

参考: [Supabase S3互換範囲](https://supabase.com/docs/guides/storage/s3/compatibility)、[GitHub Actionsの実行通知](https://docs.github.com/en/actions/concepts/workflows-and-actions/notifications-for-workflow-runs)、[2026-10-09のlegacy実機復元記録](storage-restore-2026-10-09.md)。
