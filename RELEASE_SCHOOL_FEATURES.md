# 学校別機能の過去の実装記録

この文書は初期の設計記録です。現在の状態は [リリース状況](RELEASE_STATUS.md) と [本番点検記録](docs/production-readiness.md) を参照してください。
「公開承認時にのみAI生成」「一括登録・研究入門は未回収」「復旧先はlti-explore.vercel.app」等は現在の状態と異なります。現在は登録後の解析・保存と公開が別操作です。

---

School feature controls and approval-time AI
- School feature_settings stores teacher/student menu choices. Existing schools default to enabled.
- Accounts are issued only after saving the selected school's settings. A separate save button updates existing memberships' shared menu policy.
- Restricted record policies supplement, never replace, existing membership and ownership RLS. Search and AI review endpoints also check feature permission.
- AI insights are generated only when LTI approves a paper for publication. A compare-and-swap claim on the paper precedes the provider request. Result storage is server-side; repeated approval does not regenerate. An interrupted processing claim is not automatically retried to avoid repeat billing.
- Original publication survives AI failure. Live paid inference has not been tested; ANTHROPIC_API_KEY is still required.
- Author display and author-written abstract are optional. Empty author means 著者名非公開; this does not remove names inside uploaded files.
- Password recovery redirect is fixed to the production URL. Supabase Auth Site URL and allowed Redirect URLs must both include https://lti-explore.vercel.app/; check recovery email template. Auth configuration is not writable with the connected tools, so dashboard setup remains required.
- Remaining earlier requests: bulk PDF/DOCX import, research artifact formats, and Research Intro have not been recovered from the unavailable workspace.
