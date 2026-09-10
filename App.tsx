import { ScholarlySearch } from './ScholarlySearch';
'use client';
import React, { useState, useEffect } from 'react';
import {PublishedFields,AdminAnalytics} from './analytics';
import { CloudGate, useCloud, useCloudList, saveMyProfile, uploadPdf, PdfView, type Profile } from './cloud';
import { Home, BarChart3, Users, Settings, Search, LogOut, Lock, User, Check, ArrowLeft, UserCheck, ShieldCheck, UserCog, Building2, BookOpen, FileText, Bot, Trophy, ChevronRight, Upload, Send, Edit3, Trash2, CheckCircle2, XCircle, PieChart, FileUp, Eye, EyeOff, Clock, FileCheck, Globe, LockKeyhole, AlertCircle, Lightbulb, FlaskConical, GripVertical } from 'lucide-react';

// ----------------------------------------
// 型定義
// ----------------------------------------
type SubmissionData = {
  storagePath?: string;
  submittedText: string;
  submittedFile: File | { name: string; size?: number } | null;
  status: string;
  submittedAt: string;
  late?: boolean;
  targetTeacherId?: string;
};

type AssignmentData = {
  id: number;
  title: string;
  deadline: string;
  status: string;
  description: string;
  submissions: Record<string, SubmissionData>;
  schoolId: string;
};

type PaperMessage = {
  id: number;
  sender: 'lti' | 'teacher';
  senderName: string;
  text: string;
  createdAt: string;
};

type PublicPaper = {
  storagePath?: string;
  withdrawalRequested?: boolean;
  id: number;
  title: string;
  schoolName: string;
  schoolId: string;
  submittedByTeacherName: string;
  submittedByTeacherId: string;
  field: string;
  publishedDate: string;
  views: number;
  author: string;
  status: '承認待ち' | '公開中' | '差し戻し' | '公開停止';
  submittedDate: string;
  fileName?: string;
  abstract?: string;
  messages?: PaperMessage[];
  isPickedUp?: boolean;
};

type ContestItem = {
  id: number;
  title: string;
  category: string;
  date: string;
  deadlineDate?: string; // YYYY-MM-DD形式。期限切れ判定に使用
  description: string;
  targetType: 'all' | 'specific'; // 'all': 一斉公開, 'specific': 特定校のみ
  targetSchoolIds?: string[];      // 特定校の場合の学校IDリスト
};

type NoticeItem = {
  id: number;
  title: string;
  date: string;
  content: string;
};

type LtiAdminUser = {
  id: string;
  email: string;
  name: string;
  pass: string;
};

// 教材の1スライド分（画像＋任意のキャプション）
type MaterialSlide = {
  id: string;
  imageUrl: string;
  caption: string;
};

type TeachingMaterial = {
  id: number;
  schoolId: string;
  title: string;
  description: string;
  slides: MaterialSlide[];
  uploadedAt: string;
};

// AIによる継続研究の提案（1件分）
// ※現時点ではフロントの型・状態管理のみ。実際のAI呼び出しはSupabase移行時にAPIルートと繋ぎ込む予定。
type AiSuggestion = {
  title: string;
  description: string;
  tags: string[];
};

// AI添削の結果（1論文分：修正点・アドバイス・追加実験の方向性）
type AiReviewResult = {
  corrections: string[];
  advice: string[];
  nextExperiments: string[];
};

// AI添削タブで処理中〜未送信の1行分の状態（ドロップ〜送信前の作業用ドラフト）
type AiReviewItem = {
  id: string;
  fileName: string;
  paperTitle: string;
  status: 'processing' | 'done' | 'error';
  error?: string;
  result: AiReviewResult;
  studentId: string;
  note: string;
  sent: boolean;
};

// 教員からAI添削結果を受け取った生徒宛メッセージ（送信済み・生徒側に表示される）
type StudentFeedbackMessage = {
  id: number;
  assignmentId?: string;
  schoolId: string;
  studentId: string;
  teacherName: string;
  paperTitle: string;
  fileName: string;
  result: AiReviewResult;
  note: string;
  sentAt: string;
  read: boolean;
};

// ----------------------------------------
// 初期データ定義
// ----------------------------------------

// 論文の研究分野カテゴリ（教員が申請時に選択する固定リスト）
const PAPER_FIELD_OPTIONS = ['生物', '物理', '地学', '化学', '物作り', '社会科学', '生命倫理'] as const;

// 「みんなの論文」検索：タイトル・著者・学校名・分野を対象に部分一致で判定
const matchesPaperSearch = (paper: PublicPaper, query: string) => {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    paper.title.toLowerCase().includes(q) ||
    paper.author.toLowerCase().includes(q) ||
    paper.schoolName.toLowerCase().includes(q) ||
    paper.field.toLowerCase().includes(q)
  );
};

// Runtime records are loaded from Supabase; no demo accounts or records are bundled.
const DEFAULT_REGISTERED_SCHOOL_IDS: string[] = [];
const DEFAULT_LTI_ADMIN_USERS: LtiAdminUser[] = [];
const DEFAULT_PAPERS: PublicPaper[] = [];
const DEFAULT_ASSIGNMENTS: AssignmentData[] = [];
const DEFAULT_TEACHING_MATERIALS: TeachingMaterial[] = [];
const DEFAULT_CONTESTS: ContestItem[] = [];
const DEFAULT_NOTICES: NoticeItem[] = [];
const generateInitialTeachers = (): {id:string;name:string;dept:string;pass:string;schoolId:string}[] => [];
const generateInitialStudents = (): {id:string;name:string;class:string;pass:string;theme:string;schoolId:string}[] => [];

// サイドバーのタブ並び替え：保存済みの並び順と、実際に存在するタブ名一覧を突き合わせて
// 並び順を確定する（保存後にタブが増減しても壊れないようにする）
const reconcileMenuOrder = (storedOrder: string[], allNames: string[]): string[] => {
  const known = storedOrder.filter(n => allNames.includes(n));
  const missing = allNames.filter(n => !known.includes(n));
  return [...known, ...missing];
};

// Helper for local storage
function useLocalStorage<T>(key: string, initialValue: T): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [storedValue, setStoredValue] = useState<T>(() => {
    if (typeof window === 'undefined') return initialValue;
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.error(error);
      return initialValue;
    }
  });

  useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(key, JSON.stringify(storedValue));
      }
    } catch (error) {
      console.error(error);
    }
  }, [key, storedValue]);

  return [storedValue, setStoredValue];
}

// ----------------------------------------
// モーダル群（App関数の外＝トップレベルの独立コンポーネントとして定義）
// ※ App内部の入れ子関数として定義すると、Appが再レンダリングされるたびに
//   これらのコンポーネントが「別物」として扱われ、DOMごと作り直されてしまう。
//   その結果、日本語入力（IME）の変換中の状態が毎回リセットされ、
//   一文字ごとに確定されたような挙動になっていた。トップレベルに出すことで解消する。
// ----------------------------------------
const PaperPreviewModal = ({
  previewPaper, setPreviewPaper, step, schoolId, paperReplyDraft, setPaperReplyDraft, handleSendPaperMessage
}: {
  previewPaper: PublicPaper | null;
  setPreviewPaper: (p: PublicPaper | null) => void;
  step: string;
  schoolId: string;
  paperReplyDraft: string;
  setPaperReplyDraft: (v: string) => void;
  handleSendPaperMessage: (paperId: number, text: string) => void;
}) => {
  if (!previewPaper) return null;
  const canSeeThread = step === 'lti-admin' || (step === 'teacher' && previewPaper.schoolId === schoolId);
  const isLtiViewer = step === 'lti-admin';
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full p-6 space-y-4 shadow-xl border border-gray-200 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b pb-3">
          <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700">
            {previewPaper.field}
          </span>
          <button 
            onClick={() => setPreviewPaper(null)}
            className="text-gray-400 hover:text-gray-600 font-bold text-sm"
          >
            ✕ 閉じる
          </button>
        </div>
        <div>
          <h3 className="text-lg font-bold text-gray-900">{previewPaper.title}</h3>
          <div className="text-xs text-gray-500 mt-1 space-y-0.5">
            <p>学校: {previewPaper.schoolName} ({previewPaper.schoolId})</p>
            <p>著者: {previewPaper.author} | 担当: {previewPaper.submittedByTeacherName} 先生</p>
            <p>申請日: {previewPaper.submittedDate} | 添付ファイル: {previewPaper.fileName || '論文原稿.pdf'}</p>
          </div>
        </div>
        <div className="p-4 bg-gray-50 rounded-xl border border-gray-200 text-xs text-gray-700 space-y-2">
          <p className="font-bold text-gray-900">【論文概要・アブストラクト】</p>
          <p className="leading-relaxed whitespace-pre-wrap">{previewPaper.abstract || '（概要が設定されていません）'}</p>
        </div>

        {canSeeThread && (
          <div className="border-t border-gray-100 pt-4 space-y-3">
            <p className="font-bold text-xs text-gray-900 flex items-center gap-1.5">
              💬 LTI運営とのやり取り {previewPaper.messages && previewPaper.messages.length > 0 && `(${previewPaper.messages.length}件)`}
            </p>
            <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
              {(!previewPaper.messages || previewPaper.messages.length === 0) ? (
                <p className="text-[11px] text-gray-400 italic">まだメッセージのやり取りはありません。</p>
              ) : (
                previewPaper.messages.map(m => (
                  <div key={m.id} className={`p-3 rounded-xl text-xs ${m.sender === 'lti' ? 'bg-indigo-50 border border-indigo-100' : 'bg-orange-50 border border-orange-100'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`font-bold ${m.sender === 'lti' ? 'text-indigo-700' : 'text-orange-700'}`}>
                        {m.sender === 'lti' ? '🏢 ' : '🧑‍🏫 '}{m.senderName}
                      </span>
                      <span className="text-[10px] text-gray-400 font-mono">{m.createdAt}</span>
                    </div>
                    <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">{m.text}</p>
                  </div>
                ))
              )}
            </div>
            <div className="flex items-start gap-2 pt-1">
              <textarea
                value={paperReplyDraft}
                onChange={(e) => setPaperReplyDraft(e.target.value)}
                placeholder={isLtiViewer ? '学校側へのメッセージを入力...' : 'LTI運営への返信を入力...'}
                rows={2}
                className="flex-1 px-3 py-2 bg-gray-50 border border-gray-300 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 resize-none"
              ></textarea>
              <button
                onClick={() => handleSendPaperMessage(previewPaper.id, paperReplyDraft)}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs rounded-xl shadow-sm whitespace-nowrap"
              >
                <Send className="w-3.5 h-3.5 inline mr-1" />送信
              </button>
            </div>
          </div>
        )}

        <PdfView path={previewPaper.storagePath} />
        <div className="pt-2 flex justify-end">
          <button
            onClick={() => { setPreviewPaper(null); setPaperReplyDraft(''); }}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs rounded-xl"
          >
            閉じる
          </button>
        </div>
      </div>
    </div>
  );
};

// ----------------------------------------
// 「みんなの論文」詳細ビュー（左：論文本文 / 右：AIの継続研究提案）
// ----------------------------------------
const PaperDetailSplitView = ({
  detailPaper, onBack, aiSuggestions, aiLoading, aiError, onRetry,
}: {
  detailPaper: PublicPaper;
  onBack: () => void;
  aiSuggestions: AiSuggestion[];
  aiLoading: boolean;
  aiError: string;
  onRetry: () => void;
}) => {
  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="text-xs font-bold text-gray-500 hover:text-gray-800 flex items-center gap-1"
      >
        <ChevronRight className="w-3.5 h-3.5 rotate-180" /> 論文一覧に戻る
      </button>

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,3fr)_minmax(260px,1fr)] gap-6 items-start">
        {/* 左：論文ビューア */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="p-6 border-b border-gray-100 space-y-2">
            <span className="text-xs font-bold px-2.5 py-0.5 rounded bg-indigo-50 text-indigo-700 inline-block">
              {detailPaper.field}
            </span>
            <h2 className="text-xl font-bold text-gray-900 leading-snug">{detailPaper.title}</h2>
            <div className="text-xs text-gray-500 space-y-0.5">
              <p>学校: {detailPaper.schoolName}</p>
              <p>著者: {detailPaper.author} | 担当: {detailPaper.submittedByTeacherName} 先生</p>
              <p>申請日: {detailPaper.submittedDate} | 添付ファイル: {detailPaper.fileName || '探究論文原稿.pdf'}</p>
            </div>
          </div>

          <div className="p-4 space-y-3">
            <PdfView path={detailPaper.storagePath} />
            <div className="flex items-center justify-between text-xs font-bold text-gray-500 px-1">
              <span className="flex items-center gap-1.5"><FileText className="w-3.5 h-3.5" /> 論文を読む</span>
              <span className="font-mono text-gray-400">1 / 1</span>
            </div>
            <div className="bg-gray-50 border border-gray-200 rounded-xl p-6 max-h-[600px] overflow-y-auto">
              <div className="bg-white shadow-sm border border-gray-200 rounded-lg p-8 mx-auto max-w-2xl space-y-4">
                <h3 className="text-lg font-bold text-gray-900 text-center leading-snug">{detailPaper.title}</h3>
                <p className="text-xs text-gray-500 text-center">{detailPaper.author}（{detailPaper.schoolName}）</p>
                <div className="pt-3 space-y-2">
                  <p className="text-xs font-bold text-gray-900">【論文概要・アブストラクト】</p>
                  <p className="text-xs text-gray-700 leading-relaxed whitespace-pre-wrap">
                    {detailPaper.abstract || '（概要が設定されていません）'}
                  </p>
                </div>
                <p className="text-[10px] text-gray-400 pt-4 border-t border-gray-100">
                  添付原稿は上部に自動表示されます。
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 右：AIからの継続研究のおすすめ */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4 lg:sticky lg:top-4">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-bold text-gray-900 flex items-center gap-1.5">
              <Bot className="w-4 h-4 text-emerald-600" /> AIからの継続研究のおすすめ
            </h3>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">AI提案</span>
          </div>
          <p className="text-xs text-gray-500 leading-relaxed">
            この論文の内容をもとに、継続研究を進めるための手法や切り口を提案します。興味のあるテーマを参考に、次の研究計画を立ててみましょう。
          </p>

          {aiLoading && (
            <div className="py-10 flex flex-col items-center justify-center gap-2 text-xs text-gray-400">
              <div className="w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
              AIが継続研究のアイデアを考えています...
            </div>
          )}

          {!aiLoading && aiError && (
            <div className="p-4 bg-amber-50 border border-amber-100 rounded-xl text-xs text-amber-800 space-y-2">
              <p>{aiError}</p>
              <button
                onClick={onRetry}
                className="px-3 py-1.5 bg-white border border-amber-200 hover:bg-amber-100 text-amber-800 font-bold text-[11px] rounded-lg"
              >
                再試行する
              </button>
            </div>
          )}

          {!aiLoading && !aiError && aiSuggestions.length === 0 && (
            <p className="text-xs text-gray-400 italic py-6 text-center">提案がまだありません。</p>
          )}

          {!aiLoading && !aiError && aiSuggestions.length > 0 && (
            <div className="space-y-3">
              {aiSuggestions.map((s, i) => (
                <div key={i} className="p-4 bg-gray-50 border border-gray-200 rounded-xl space-y-2">
                  <p className="text-xs font-bold text-gray-900 flex items-start gap-2">
                    <span className="w-4 h-4 rounded-full bg-emerald-600 text-white text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    {s.title}
                  </p>
                  <p className="text-[11px] text-gray-600 leading-relaxed">{s.description}</p>
                  {s.tags && s.tags.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <span className="text-[10px] font-bold text-gray-400">アプローチ例</span>
                      {s.tags.map((t, ti) => (
                        <span key={ti} className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">
                          {t}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const RejectPaperModal = ({
  rejectTargetPaper, setRejectTargetPaper, rejectMessageDraft, setRejectMessageDraft, handleConfirmRejectPaper
}: {
  rejectTargetPaper: PublicPaper | null;
  setRejectTargetPaper: (p: PublicPaper | null) => void;
  rejectMessageDraft: string;
  setRejectMessageDraft: (v: string) => void;
  handleConfirmRejectPaper: () => void;
}) => {
  if (!rejectTargetPaper) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 space-y-4 shadow-2xl border border-gray-200">
        <div className="flex items-center justify-between border-b pb-3">
          <h3 className="text-base font-bold text-gray-900">論文を差し戻す</h3>
          <button onClick={() => { setRejectTargetPaper(null); setRejectMessageDraft(''); }} className="text-gray-400 hover:text-gray-600 font-bold text-sm">✕ 閉じる</button>
        </div>
        <p className="text-xs text-gray-500">「{rejectTargetPaper.title}」（{rejectTargetPaper.schoolName} / {rejectTargetPaper.submittedByTeacherName} 先生）を差し戻します。</p>
        <div className="space-y-1">
          <label className="text-xs font-bold text-gray-700">差し戻し理由・修正依頼メッセージ（任意）</label>
          <textarea
            value={rejectMessageDraft}
            onChange={(e) => setRejectMessageDraft(e.target.value)}
            placeholder="例: アブストラクトの内容をもう少し具体的にご記載ください。"
            rows={4}
            className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-xs font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 resize-none"
          ></textarea>
          <p className="text-[10px] text-gray-400">入力すると、担当教員の画面にメッセージとして届きます。</p>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={() => { setRejectTargetPaper(null); setRejectMessageDraft(''); }}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs rounded-xl"
          >
            キャンセル
          </button>
          <button
            onClick={handleConfirmRejectPaper}
            className="px-4 py-2 bg-gray-800 hover:bg-gray-900 text-white font-bold text-xs rounded-xl shadow-sm"
          >
            差し戻す
          </button>
        </div>
      </div>
    </div>
  );
};

const PdfPreviewModal = ({
  previewPdfModalData, setPreviewPdfModalData
}: {
  previewPdfModalData: { studentName: string; fileName: string; text: string; storagePath?: string } | null;
  setPreviewPdfModalData: (v: { studentName: string; fileName: string; text: string; storagePath?: string } | null) => void;
}) => {
  if (!previewPdfModalData) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="bg-white rounded-2xl max-w-3xl w-full p-6 space-y-4 shadow-2xl border border-gray-200">
        <div className="flex items-center justify-between border-b pb-3">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-emerald-600" />
            <h3 className="text-base font-bold text-gray-900">提出PDFのプレビュー確認</h3>
          </div>
          <button 
            onClick={() => setPreviewPdfModalData(null)}
            className="text-gray-400 hover:text-gray-600 font-bold text-sm"
          >
            ✕ 閉じる
          </button>
        </div>
        <div className="space-y-1 text-xs text-gray-600 bg-gray-50 p-3 rounded-xl">
          <p><span className="font-bold text-gray-800">生徒名:</span> {previewPdfModalData.studentName}</p>
          <p><span className="font-bold text-gray-800">ファイル名:</span> {previewPdfModalData.fileName}</p>
        </div>
        <div className="border border-gray-300 rounded-xl bg-gray-100 p-6 space-y-3 max-h-[75vh] overflow-auto">
          <div className="w-16 h-16 bg-red-100 text-red-600 rounded-2xl flex items-center justify-center font-bold text-xl shadow-sm">
            PDF
          </div>
          <PdfView path={previewPdfModalData.storagePath} />
          <p className="font-bold text-sm text-gray-800">{previewPdfModalData.fileName}</p>
          <p className="text-xs text-gray-500 max-w-md">PDFが添付されている場合は、認証後に読み込んで表示します。</p>
        </div>
        <div className="pt-2 flex justify-end">
          <button
            onClick={() => setPreviewPdfModalData(null)}
            className="px-5 py-2.5 bg-gray-800 hover:bg-gray-900 text-white font-bold text-xs rounded-xl"
          >
            プレビューを閉じる
          </button>
        </div>
      </div>
    </div>
  );
};

const MaterialPreviewModal = ({previewMaterialModalData:mat,setPreviewMaterialModalData:close}:{previewMaterialModalData:TeachingMaterial|null;setPreviewMaterialModalData:(v:TeachingMaterial|null)=>void}) => {
 const [full,setFull]=useState(false);
 if(!mat)return null;
 return <div className="fixed inset-0 z-[90] bg-black/70 p-2 flex justify-center"><section className={`bg-white overflow-auto ${full?'w-full':'max-w-5xl w-full rounded-2xl'}`}><header className="sticky top-0 bg-white border-b p-4 flex gap-4 items-center z-10"><h2 className="font-bold flex-1">{mat.title}</h2><button onClick={()=>setFull(!full)}>{full?'通常表示':'全画面表示'}</button><button onClick={()=>close(null)}>閉じる</button></header><p className="p-5 text-gray-600">{mat.description}</p>{mat.slides.map((slide,i)=><figure key={slide.id} className="mx-auto max-w-5xl"><img src={slide.imageUrl} alt={slide.caption||`教材 ${i+1}ページ`} loading="lazy" className="w-full h-auto"/>{slide.caption&&<figcaption className="p-4 text-sm">{slide.caption}</figcaption>}</figure>)}</section></div>;
};

const ResubmitConfirmModal = ({
  showResubmitConfirmModal, setShowResubmitConfirmModal, selectedAssignmentId, assignments, setAssignments,
  currentStudentId, setStudentSubmissionText, setStudentSubmissionFile, setStudentSubmitSuccessMsg
}: {
  showResubmitConfirmModal: boolean;
  setShowResubmitConfirmModal: (v: boolean) => void;
  selectedAssignmentId: number | null;
  assignments: AssignmentData[];
  setAssignments: (v: AssignmentData[]) => void;
  currentStudentId: string;
  setStudentSubmissionText: (v: string) => void;
  setStudentSubmissionFile: (v: File | null) => void;
  setStudentSubmitSuccessMsg: (v: string) => void;
}) => {
  if (!showResubmitConfirmModal) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 space-y-5 shadow-2xl border border-gray-200">
        <div className="flex items-center gap-3 text-amber-600">
          <Clock className="w-6 h-6 shrink-0" />
          <h3 className="text-lg font-extrabold text-gray-900">課題の再提出確認</h3>
        </div>
        
        <p className="text-sm font-bold text-gray-700 leading-relaxed bg-amber-50 p-4 rounded-xl border border-amber-200">
          課題を再提出しますか、現在提出中の課題は削除されます
        </p>

        <div className="flex items-center justify-end gap-3 pt-2">
          <button
            onClick={() => setShowResubmitConfirmModal(false)}
            className="px-4 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold text-xs rounded-xl transition-colors"
          >
            戻る
          </button>
          <button
            onClick={() => {
              if (selectedAssignmentId) {
                setAssignments(assignments.map(a => {
                  if (a.id === selectedAssignmentId && a.submissions[currentStudentId]) {
                    const newSubmissions = { ...a.submissions };
                    delete newSubmissions[currentStudentId];
                    return { ...a, submissions: newSubmissions };
                  }
                  return a;
                }));
                setStudentSubmissionText('');
                setStudentSubmissionFile(null);
                setStudentSubmitSuccessMsg('前回の提出をクリアしました。新しい内容を入力して提出してください。');
              }
              setShowResubmitConfirmModal(false);
            }}
            className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs rounded-xl transition-colors shadow-sm"
          >
            承認する
          </button>
        </div>
      </div>
    </div>
  );
};

type AcademicReference = {
  catalogId?: string; sourceUrl?: string; documentUrl?: string;
  id?: string; schoolId?: string; doi: string; title: string; authors: string; year: string; journal: string;
  note: string; topic: string; reading: '未読' | '読書中' | '読了';
};

const referenceKey = (p: AcademicReference) => p.catalogId || p.doi;
function AcademicPaperSearch({ storageKey }: { storageKey: string }) {
  const cloud = useCloud();
  const [saved, setSaved] = useCloudList<AcademicReference[]>('lti_academic_references', []);
  const [view, setView] = useState<'search' | 'saved'>('search');
  const [topicFilter, setTopicFilter] = useState('');
  const [message, setMessage] = useState('');
  const persist = (next: AcademicReference[]) => setSaved(next.map(p=>({...p,id:p.id||`${cloud.profile.id}:${referenceKey(p)}`,schoolId:cloud.profile.school_id||undefined})));
  const citation = (p: AcademicReference) => `${p.authors||'著者不明'} (${p.year||'年不明'}). ${p.title}. ${p.journal}. ${p.sourceUrl||'https://doi.org/'+p.doi}`;
  const displayed = saved.filter(p=>!topicFilter.trim()||(p.topic||'').toLowerCase().includes(topicFilter.trim().toLowerCase()));
  const update = (key:string,patch:Partial<AcademicReference>) => persist(saved.map(p=>referenceKey(p)===key?{...p,...patch}:p));
  const copy = async()=>{try{await navigator.clipboard.writeText(displayed.map(citation).join('\n\n'));setMessage('参考文献一覧をコピーしました。');}catch{setMessage('下の一覧を選択してコピーしてください。');}};
  return (<div className="space-y-5">
    <div className="bg-white p-6 rounded-2xl border space-y-2"><h2 className="text-lg font-bold">学術論文の検索</h2><p className="text-sm text-gray-600">研究キーワードから論文を探して、本文を読み、参考文献として保存できます。</p></div>
    <div className="flex gap-3"><button type="button" onClick={()=>setView('search')} aria-pressed={view==='search'} className="border rounded-xl px-4 py-2">論文を検索</button><button type="button" onClick={()=>setView('saved')} aria-pressed={view==='saved'} className="border rounded-xl px-4 py-2">保存した文献（{saved.length}）</button></div>
    <div hidden={view!=='search'}><ScholarlySearch savedKeys={saved.map(referenceKey)} onSave={p=>{if(!saved.some(s=>referenceKey(s)===(p.doi||p.catalogId)))persist([...saved,{...p,note:'',topic:'',reading:'未読'}]);}} /></div>
    {view==='saved' && <>
      <input aria-label="研究テーマで絞り込み" value={topicFilter} onChange={e=>setTopicFilter(e.target.value)} placeholder="研究テーマで絞り込み" className="w-full border rounded-xl p-3" />
      <p className="text-xs text-gray-500">メモを編集したら「メモを保存」を押してください。</p>
      {!displayed.length&&<p>保存した文献がないか、条件に一致しません。</p>}
      {displayed.map(p => {
        
        return <article key={referenceKey(p)} className="bg-white border border-gray-200 rounded-2xl p-5 space-y-3">
          <h3 className="font-bold text-gray-900">{p.title}</h3>
          <p className="text-xs text-gray-600 break-words">{p.authors || '著者情報なし'} / {p.year || '発表年不明'} / {p.journal}</p>
          <div className="flex flex-wrap items-center gap-4 text-sm">
            {p.documentUrl && <a href={p.documentUrl} target="_blank" rel="noopener noreferrer" className="text-emerald-700 underline">本文・概要を読む ↗</a>}
            <a href={p.sourceUrl || `https://doi.org/${encodeURIComponent(p.doi)}`} target="_blank" rel="noopener noreferrer" className="text-emerald-700 underline">掲載先を開く ↗</a>
            {<button type="button" onClick={() => { if (window.confirm('この文献とメモを保存一覧から削除しますか？')) persist(saved.filter(s => referenceKey(s) !== referenceKey(p))); }} className="text-red-600">削除</button>}
          </div>
          {view === 'saved' && <form key={JSON.stringify([p.topic,p.note,p.reading])} className="space-y-3" onSubmit={e=>{e.preventDefault();const form=new FormData(e.currentTarget);update(referenceKey(p),{topic:String(form.get('topic')||''),note:String(form.get('note')||''),reading:String(form.get('reading')) as AcademicReference['reading']});}}>
            <label className="block text-xs">研究テーマ<input name="topic" defaultValue={p.topic} className="block w-full border rounded-lg p-2" /></label>
            <label className="block text-xs">読書状況<select name="reading" defaultValue={p.reading} className="border p-2">{['未読','読書中','読了'].map(v=><option key={v}>{v}</option>)}</select></label>
            <label className="block text-xs">参考になった点・自分の研究との違い<textarea name="note" defaultValue={p.note} rows={3} className="block w-full border rounded-lg p-2" /></label>
            <button className="text-emerald-700 font-bold">メモを保存</button>
          </form>}
        </article>;
      })}

    </>}
      {view === 'saved' && displayed.length > 0 && <div className="bg-white p-5 border rounded-2xl space-y-3">
        <h3 className="font-bold text-gray-900">参考文献一覧（表示中の文献）</h3>
        <p className="text-xs text-gray-500">簡易形式です。提出先の書式と著者・発表年を確認してください。</p>
        <textarea aria-label="参考文献一覧" readOnly value={displayed.map(citation).join('\n\n')} rows={6} className="w-full border rounded-lg p-3 text-sm text-gray-900" />
        <button type="button" onClick={copy} className="px-4 py-2 rounded-xl bg-emerald-600 text-white">一覧をコピー</button>
        <p role="status" className="text-xs text-gray-600">{message}</p>
      </div>}
    </div>
  );
}

export default function App() {
  return <CloudGate>{(profile, signOut) => <ConnectedApp key={profile.id + profile.role + profile.school_id} profile={profile} signOut={signOut}/>}</CloudGate>;
}

function ConnectedApp({profile, signOut}: {profile: Profile; signOut: () => Promise<void>}) {
  const cloud = useCloud();
  // ステップ管理
  const [step, setStep] = useState<'portal-select' | 'school-input' | 'role-select' | 'login-form' | 'teacher' | 'student' | 'lti-login' | 'lti-admin'>(profile.role === 'admin' ? 'lti-admin' : profile.role);
  
  const [schoolId, setSchoolId] = useState(profile.school_id || '');
  const [inputSchoolId, setInputSchoolId] = useState('');
  const [schoolError, setSchoolError] = useState('');
  const [selectedRole, setSelectedRole] = useState<'teacher' | 'student' | null>(null);
  const [currentTab, setCurrentTab] = useState('ホーム');
  const [inputLoginId, setInputLoginId] = useState('');
  const [inputPassword, setInputPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  // モード・モーダル管理用ステート
  const [previewPaper, setPreviewPaper] = useState<PublicPaper | null>(null);

  // 「みんなの論文」で生徒が選択した論文の詳細（分割ビュー）用ステート
  // ※現時点ではフロントのみ。fetchContinuationSuggestions は /api/continuation-suggestions
  //   （Supabase移行時に実装予定）を叩く形で用意してあるので、バックエンド未実装の間はエラー表示になる。
  const [detailPaper, setDetailPaper] = useState<PublicPaper | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<AiSuggestion[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState('');

  const fetchContinuationSuggestions = async (_paper: PublicPaper) => {
    setAiSuggestions([]); setAiLoading(false); setAiError('AI連携は未設定です。AI提供元の接続後に利用できます。');
  };

  // 「論文を読む」クリック時：モーダルではなく分割ビューを開く
  const openPaperDetail = (paper: PublicPaper) => {
    setDetailPaper(paper);
    fetchContinuationSuggestions(paper);
  };

  // 生徒課題再提出確認モーダル表示ステート
  const [showResubmitConfirmModal, setShowResubmitConfirmModal] = useState(false);

  // 提出物PDFプレビュー用モーダルステート
  const [previewPdfModalData, setPreviewPdfModalData] = useState<{ studentName: string; fileName: string; text: string; storagePath?: string } | null>(null);
  const [previewMaterialModalData, setPreviewMaterialModalData] = useState<TeachingMaterial | null>(null);

  // ----------------------------------------
  // LocalStorage連動の編集可能データステート
  // ----------------------------------------
  const [ltiAdminUsers, setLtiAdminUsers] = useCloudList<LtiAdminUser[]>('lti_admin_users', DEFAULT_LTI_ADMIN_USERS);
  const [papers, setPapers] = useCloudList<PublicPaper[]>('lti_papers', DEFAULT_PAPERS);
  const [assignments, setAssignments] = useCloudList<AssignmentData[]>('lti_assignments', DEFAULT_ASSIGNMENTS);
  const [teachingMaterials, setTeachingMaterials] = useCloudList<TeachingMaterial[]>('lti_teaching_materials', DEFAULT_TEACHING_MATERIALS);
  const [teachersList, setTeachersList] = useCloudList('lti_teachers_list', generateInitialTeachers());
  const [studentsList, setStudentsList] = useCloudList('lti_students_list', generateInitialStudents());
  // AI添削の結果を送信した、生徒宛メッセージの一覧（教員・生徒どちらの画面からも参照する）
  const [studentFeedbackMessages, setStudentFeedbackMessages] = useCloudList<StudentFeedbackMessage[]>('lti_student_feedback_messages', []);
  // サイドバーのタブ並び順（教員・生徒それぞれ、ドラッグ&ドロップで並び替えた結果を保存）
  const [teacherMenuOrder, setTeacherMenuOrder] = useLocalStorage<string[]>(`lti_teacher_menu_order:${profile.id}`, []);
  const [studentMenuOrder, setStudentMenuOrder] = useLocalStorage<string[]>(`lti_student_menu_order:${profile.id}`, []);
  const [draggedTabName, setDraggedTabName] = useState<string | null>(null);
  // 「先生からのフィードバック」で、既読カードのうち手動で再度開いているものの一覧（セッション内のみ）
  const [expandedFeedbackIds, setExpandedFeedbackIds] = useState<Set<number>>(new Set());

  // サイドバーのタブをドラッグ&ドロップで並び替えるための共通処理
  const handleTabDragStart = (name: string) => setDraggedTabName(name);
  const handleTabDragOver = (e: React.DragEvent) => { e.preventDefault(); };
  const handleTabDrop = (
    targetName: string,
    currentOrder: string[],
    setOrder: (order: string[]) => void,
    allNames: string[]
  ) => {
    if (!draggedTabName || draggedTabName === targetName) { setDraggedTabName(null); return; }
    const reconciled = reconcileMenuOrder(currentOrder, allNames);
    const fromIdx = reconciled.indexOf(draggedTabName);
    const toIdx = reconciled.indexOf(targetName);
    if (fromIdx === -1 || toIdx === -1) { setDraggedTabName(null); return; }
    const newOrder = [...reconciled];
    newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx, 0, draggedTabName);
    setOrder(newOrder);
    setDraggedTabName(null);
  };
  const [registeredSchoolIds] = useCloudList<string[]>('lti_registered_school_ids', DEFAULT_REGISTERED_SCHOOL_IDS);
  
  // 【要件②用】学会・コンテストのリスト管理
  const [contests, setContests] = useCloudList<ContestItem[]>('lti_contests', DEFAULT_CONTESTS);

  const [currentLtiAdminId, setCurrentLtiAdminId] = useState<string>(profile.id);

  // LTI運営ログイン用ステート
  const [ltiEmail, setLtiEmail] = useState('');
  const [ltiPassword, setLtiPassword] = useState('');
  const [ltiLoginError, setLtiLoginError] = useState('');
  const [ltiCurrentTab, setLtiCurrentTab] = useState('ホーム');

  // LTI運営プロファイル編集用ステート
  const [editLtiAdminName, setEditLtiAdminName] = useState(profile.name);
  const [editLtiAdminPass, setEditLtiAdminPass] = useState('');
  const [ltiProfileMessage, setLtiProfileMessage] = useState('');

  // LTI運営側：教材管理
  const [materialSchoolId, setMaterialSchoolId] = useState(cloud.schools[0]?.id || '');
  useEffect(() => { if (!materialSchoolId && cloud.schools.length) setMaterialSchoolId(cloud.schools[0].id); }, [cloud.schools, materialSchoolId]);

  // LTI運営側：論文管理・学校管理の各画面で使う「選択中の学校」共通ステート
  const [ltiManageSchoolId, setLtiManageSchoolId] = useState<string>('');

  const handleTogglePickup = (id: number) => {
    setPapers(papers.map(p => p.id === id ? { ...p, isPickedUp: !p.isPickedUp } : p));
  };
  const [newMaterialTitle, setNewMaterialTitle] = useState('');
  const [newMaterialDesc, setNewMaterialDesc] = useState('');
  // 教材（スライド）作成ドラフト：画像を追加していく形の教材ビルダー用ステート
  const [draftSlides, setDraftSlides] = useState<MaterialSlide[]>([]);
  const [materialMessage, setMaterialMessage] = useState('');

  // 【要件②用】LTI運営側：学会・コンテスト新規作成用ステート
  const [newContestTitle, setNewContestTitle] = useState('');
  const [newContestCategory, setNewContestCategory] = useState('ビジネス');
  const [newContestDate, setNewContestDate] = useState('');
  const [newContestDeadlineDate, setNewContestDeadlineDate] = useState('');
  const [newContestDesc, setNewContestDesc] = useState('');
  const [newContestTargetType, setNewContestTargetType] = useState<'all' | 'specific'>('all');
  const [newContestTargetSchools, setNewContestTargetSchools] = useState<string[]>([]);
  const [editingContestId, setEditingContestId] = useState<number | null>(null);
  const [contestMessage, setContestMessage] = useState('');

  const isContestExpired = (c: ContestItem) => {
    if (!c.deadlineDate) return false;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const deadline = new Date(c.deadlineDate + 'T23:59:59');
    return deadline.getTime() < today.getTime();
  };

  const resetContestForm = () => {
    setEditingContestId(null);
    setNewContestTitle('');
    setNewContestCategory('ビジネス');
    setNewContestDate('');
    setNewContestDeadlineDate('');
    setNewContestDesc('');
    setNewContestTargetType('all');
    setNewContestTargetSchools([]);
  };

  const handleStartEditContest = (c: ContestItem) => {
    setEditingContestId(c.id);
    setNewContestTitle(c.title);
    setNewContestCategory(c.category);
    setNewContestDate(c.date);
    setNewContestDeadlineDate(c.deadlineDate || '');
    setNewContestDesc(c.description);
    setNewContestTargetType(c.targetType);
    setNewContestTargetSchools(c.targetSchoolIds || []);
    window.scrollTo(0, 0);
  };

  const handleCreateContest = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContestTitle.trim() || !newContestDate.trim()) return;

    if (editingContestId !== null) {
      // 編集モード：既存のコンテストを更新して再公開
      setContests(contests.map(c => c.id === editingContestId ? {
        ...c,
        title: newContestTitle,
        category: newContestCategory,
        date: newContestDate,
        deadlineDate: newContestDeadlineDate || undefined,
        description: newContestDesc || '詳細説明はありません。',
        targetType: newContestTargetType,
        targetSchoolIds: newContestTargetType === 'specific' ? newContestTargetSchools : undefined
      } : c));
      setContestMessage('学会・コンテスト情報を更新し、再公開しました！');
    } else {
      const newContest: ContestItem = {
        id: Date.now(),
        title: newContestTitle,
        category: newContestCategory,
        date: newContestDate,
        deadlineDate: newContestDeadlineDate || undefined,
        description: newContestDesc || '詳細説明はありません。',
        targetType: newContestTargetType,
        targetSchoolIds: newContestTargetType === 'specific' ? newContestTargetSchools : undefined
      };
      setContests([newContest, ...contests]);
      setContestMessage('学会・コンテスト情報を正常に配信しました！');
    }

    resetContestForm();
    setTimeout(() => setContestMessage(''), 4000);
  };

  const handleDeleteContest = (id: number) => {
    if (confirm('この学会・コンテスト情報を削除しますか？')) {
      setContests(contests.filter(c => c.id !== id));
      if (editingContestId === id) resetContestForm();
    }
  };

  // 【要件③用】LTI運営側：お知らせ管理用ステート
  const [newNoticeTitle, setNewNoticeTitle] = useState('');
  const [newNoticeContent, setNewNoticeContent] = useState('');
  const [editingNoticeId, setEditingNoticeId] = useState<number | null>(null);
  const [noticeMessage, setNoticeMessage] = useState('');

  const resetNoticeForm = () => {
    setEditingNoticeId(null);
    setNewNoticeTitle('');
    setNewNoticeContent('');
  };

  const handleStartEditNotice = (n: NoticeItem) => {
    setEditingNoticeId(n.id);
    setNewNoticeTitle(n.title);
    setNewNoticeContent(n.content);
    window.scrollTo(0, 0);
  };

  const handleSaveNotice = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNoticeTitle.trim()) return;
    const todayStr = new Date().toISOString().split('T')[0].replace(/-/g, '/');

    if (editingNoticeId !== null) {
      setNotices(notices.map(n => n.id === editingNoticeId ? { ...n, title: newNoticeTitle, content: newNoticeContent } : n));
      setNoticeMessage('お知らせを更新しました！');
    } else {
      const newNotice: NoticeItem = { id: Date.now(), title: newNoticeTitle, date: todayStr, content: newNoticeContent || '詳細はありません。' };
      setNotices([newNotice, ...notices]);
      setNoticeMessage('お知らせを配信しました！生徒・教員のホーム画面に表示されます。');
    }
    resetNoticeForm();
    setTimeout(() => setNoticeMessage(''), 4000);
  };

  const handleDeleteNotice = (id: number) => {
    if (confirm('このお知らせを削除しますか？')) {
      setNotices(notices.filter(n => n.id !== id));
      if (editingNoticeId === id) resetNoticeForm();
    }
  };

  // 【要件①用】論文の差し戻し（メッセージ付き）・スレッド返信
  const [rejectTargetPaper, setRejectTargetPaper] = useState<PublicPaper | null>(null);
  const [rejectMessageDraft, setRejectMessageDraft] = useState('');
  const [paperReplyDraft, setPaperReplyDraft] = useState('');

  const nowJpString = () => new Date().toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

  const handleConfirmRejectPaper = () => {
    if (!rejectTargetPaper) return;
    const senderName = ltiAdminUsers.find(u => u.id === currentLtiAdminId)?.name || 'LTI運営';
    setPapers(papers.map(p => {
      if (p.id !== rejectTargetPaper.id) return p;
      const newMessages = rejectMessageDraft.trim()
        ? [...(p.messages || []), { id: Date.now(), sender: 'lti' as const, senderName, text: rejectMessageDraft, createdAt: nowJpString() }]
        : (p.messages || []);
      return { ...p, status: '差し戻し' as const, messages: newMessages };
    }));
    setRejectTargetPaper(null);
    setRejectMessageDraft('');
  };

  const handleSendPaperMessage = (paperId: number, text: string) => {
    if (!text.trim()) return;
    const isLti = step === 'lti-admin';
    const senderName = isLti
      ? (ltiAdminUsers.find(u => u.id === currentLtiAdminId)?.name || 'LTI運営')
      : (teachersList.find(t => t.id === currentTeacherId && t.schoolId === schoolId)?.name || '教員');
    setPapers(papers.map(p => p.id === paperId ? {
      ...p,
      messages: [...(p.messages || []), { id: Date.now(), sender: (isLti ? 'lti' : 'teacher') as 'lti' | 'teacher', senderName, text, createdAt: nowJpString() }]
    } : p));
    setPaperReplyDraft('');
  };

  // 画像ファイルを1枚、教材ドラフトのスライドとして追加する（base64化してブラウザ内に保持）
  const handleAddMaterialSlideImage = (file: File | null) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      setDraftSlides(prev => [...prev, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, imageUrl: dataUrl, caption: '' }]);
    };
    reader.readAsDataURL(file);
  };

  const updateDraftSlideCaption = (id: string, caption: string) => {
    setDraftSlides(prev => prev.map(s => s.id === id ? { ...s, caption } : s));
  };

  const removeDraftSlide = (id: string) => {
    setDraftSlides(prev => prev.filter(s => s.id !== id));
  };

  const moveDraftSlide = (id: string, direction: 'up' | 'down') => {
    setDraftSlides(prev => {
      const idx = prev.findIndex(s => s.id === id);
      const newIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (idx === -1 || newIdx < 0 || newIdx >= prev.length) return prev;
      const copy = [...prev];
      [copy[idx], copy[newIdx]] = [copy[newIdx], copy[idx]];
      return copy;
    });
  };

  const handleUploadMaterial = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMaterialTitle.trim() || draftSlides.length === 0) return;

    const newMaterial: TeachingMaterial = {
      id: Date.now(),
      schoolId: materialSchoolId,
      title: newMaterialTitle,
      description: newMaterialDesc || '説明はありません。',
      slides: draftSlides,
      uploadedAt: new Date().toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    };
    setTeachingMaterials([newMaterial, ...teachingMaterials]);
    setNewMaterialTitle('');
    setNewMaterialDesc('');
    setDraftSlides([]);
    setMaterialMessage('教材をアップロードしました！（本番運用ではSupabase Storageへの保存に切り替え予定です）');
    setTimeout(() => setMaterialMessage(''), 4000);
  };

  const handleDeleteMaterial = (id: number) => {
    if (confirm('この教材を削除しますか？')) {
      setTeachingMaterials(teachingMaterials.filter(m => m.id !== id));
    }
  };

  // LTI運営管理データステート
  const [notices, setNotices] = useCloudList<NoticeItem[]>('lti_notices', DEFAULT_NOTICES);

  // 先生側：公開申請用フォームステート
  const [teacherPaperTitle, setTeacherPaperTitle] = useState('');
  const [editingPaper,setEditingPaper]=useState<PublicPaper|null>(null);
  const [teacherPaperAuthor, setTeacherPaperAuthor] = useState('');
  const [teacherPaperField, setTeacherPaperField] = useState<string>(PAPER_FIELD_OPTIONS[0]);

  // 「みんなの論文」の分野フィルター（教員側）
  const [teacherPaperFieldFilter, setTeacherPaperFieldFilter] = useState('すべて');
  // 「みんなの論文」の検索キーワード（教員側・生徒側）
  const [teacherPaperSearchQuery, setTeacherPaperSearchQuery] = useState('');
  const [studentPaperSearchQuery, setStudentPaperSearchQuery] = useState('');
  const [studentPaperFieldFilter, setStudentPaperFieldFilter] = useState('すべて');
  const [teacherPaperAbstract, setTeacherPaperAbstract] = useState('');
  const [teacherPaperFile, setTeacherPaperFile] = useState<File | null>(null);

  // AI添削タブ：ドロップ〜送信前のドラフト一覧（送信するまでは端末内のみで保持）
  const [aiReviewItems, setAiReviewItems] = useState<AiReviewItem[]>([]);
  const [teacherApplyMessage, setTeacherApplyMessage] = useState('');

  // 教師側：進捗管理で選択中の課題ID
  const [progressSelectedAssignId, setProgressSelectedAssignId] = useState<number | null>(null);

  const [newAssignTitle, setNewAssignTitle] = useState('');
  const [newAssignDeadline, setNewAssignDeadline] = useState('');
  const [newAssignDesc, setNewAssignDesc] = useState('');
  const [assignMessage, setAssignMessage] = useState('');
  const [editingAssignmentId, setEditingAssignmentId] = useState<number | null>(null);

  const [selectedAssignmentId, setSelectedAssignmentId] = useState<number | null>(null);

  const handleCreateOrUpdateAssignment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newAssignTitle.trim() || !newAssignDeadline.trim()) return;

    if (editingAssignmentId !== null) {
      setAssignments(assignments.map(a => {
        if (a.id === editingAssignmentId) {
          return {
            ...a,
            title: newAssignTitle,
            deadline: newAssignDeadline,
            description: newAssignDesc || '詳細な説明はありません。'
          };
        }
        return a;
      }));
      setAssignMessage('課題を編集・再配信しました！');
      setEditingAssignmentId(null);
    } else {
      const newAssignment: AssignmentData = {
        id: Date.now(),
        title: newAssignTitle,
        deadline: newAssignDeadline,
        status: '未提出',
        description: newAssignDesc || '詳細な説明はありません。',
        schoolId: schoolId,
        submissions: {}
      };
      setAssignments([newAssignment, ...assignments]);
      setAssignMessage('新しい課題を配信しました！');
    }
    setNewAssignTitle('');
    setNewAssignDeadline('');
    setNewAssignDesc('');
    setTimeout(() => setAssignMessage(''), 4000);
  };

  const handleEditClick = (assign: AssignmentData) => {
    setEditingAssignmentId(assign.id);
    setNewAssignTitle(assign.title);
    setNewAssignDeadline(assign.deadline.replace(/\//g, '-'));
    setNewAssignDesc(assign.description);
    setCurrentTab('課題配信');
  };

  const handleDeleteAssignment = (id: number) => {
    if (confirm('この課題を削除しますか？')) {
      setAssignments(assignments.filter(a => a.id !== id));
      if (editingAssignmentId === id) {
        setEditingAssignmentId(null);
        setNewAssignTitle('');
        setNewAssignDeadline('');
        setNewAssignDesc('');
      }
    }
  };

  const [currentTeacherId, setCurrentTeacherId] = useState(profile.id);
  const [editTeacherName, setEditTeacherName] = useState(profile.name);
  const [teacherNewPass, setTeacherNewPass] = useState('');
  const [teacherProfileMessage, setTeacherProfileMessage] = useState('');
  const [teacherAccountMessage, setTeacherAccountMessage] = useState('');

  const [currentStudentId, setCurrentStudentId] = useState(profile.id);
  const [editStudentName, setEditStudentName] = useState(profile.name);
  const [studentNewPass, setStudentNewPass] = useState('');
  const [studentProfileMessage, setStudentProfileMessage] = useState('');

  // 生徒側：課題提出用のステート
  const [studentSubmissionText, setStudentSubmissionText] = useState('');
  const [studentSubmissionFile, setStudentSubmissionFile] = useState<File | null>(null);
  const [studentSubmitSuccessMsg, setStudentSubmitSuccessMsg] = useState('');

  // 【要件①用】生徒自身の表示名およびパスワード変更の処理
  const handleStudentProfileUpdate = async (e: React.FormEvent) => {
      e.preventDefault();
      try { await saveMyProfile(editStudentName, studentNewPass); await cloud.reload(); setStudentProfileMessage('プロフィールを更新しました。'); setStudentNewPass(''); }
      catch (error) { setStudentProfileMessage((error as Error).message || '更新できませんでした'); }
    };

  const handleResetStudentPassword = (_targetId: string) => alert('ログイン画面の「パスワードを忘れた場合」から、本人が再設定してください。');
  const handleResetTeacherPassword = handleResetStudentPassword;

  // ========================================
  // ポータル選択画面
  // ========================================
  if (step === 'portal-select') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center font-sans p-4 text-gray-900">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-8 space-y-6">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 bg-emerald-600 rounded-xl mx-auto flex items-center justify-center text-white font-bold text-xl shadow-sm">L</div>
            <h1 className="text-2xl font-extrabold text-gray-900 tracking-tight">LTI Explore</h1>
            <p className="text-xs font-semibold text-gray-500">高校の自然科学探究活動支援サービス</p>
          </div>

          <div className="space-y-4 pt-2">
            <button
              onClick={() => {
                setInputSchoolId('');
                setSchoolError('');
                setStep('school-input');
              }}
              className="w-full text-left p-5 rounded-xl border border-gray-200 hover:border-emerald-500 hover:bg-emerald-50/20 transition-all shadow-sm group space-y-1 bg-white"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-gray-900 group-hover:text-emerald-700 flex items-center gap-2">
                  <Building2 className="w-4 h-4 text-emerald-600" /> 学校ログイン
                </span>
                <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-emerald-600" />
              </div>
              <p className="text-xs font-medium text-gray-500 pl-6">学校の先生・生徒はこちらからログイン</p>
            </button>

            <button
              onClick={() => {
                setLtiEmail('');
                setLtiPassword('');
                setLtiLoginError('');
                setStep('lti-login');
              }}
              className="w-full text-left p-5 rounded-xl border border-gray-200 hover:border-indigo-500 hover:bg-indigo-50/20 transition-all shadow-sm group space-y-1 bg-white"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold text-gray-900 group-hover:text-indigo-700 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-indigo-600" /> LTI運営ログイン
                </span>
                <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-indigo-600" />
              </div>
              <p className="text-xs font-medium text-gray-500 pl-6">LTI事務局・管理者はこちらからログイン</p>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ========================================
  // LTI運営ログイン画面
  // ========================================
  const handleLtiLogin = (e: React.FormEvent) => { e.preventDefault(); void signOut(); };

  if (step === 'lti-login') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center font-sans p-4 text-gray-900">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-8 space-y-6">
          <div className="flex items-center justify-between">
            <button
              onClick={() => void signOut()}
              className="text-xs font-bold text-gray-500 hover:text-gray-900 flex items-center gap-1"
            >
              <ArrowLeft className="w-4 h-4" /> 戻る
            </button>
            <span className="text-xs font-bold px-2.5 py-1 rounded-full bg-indigo-50 text-indigo-700">
              LTI運営ログイン
            </span>
          </div>

          <div className="text-center space-y-1">
            <h1 className="text-xl font-bold text-gray-900">管理者認証</h1>
            <p className="text-xs font-medium text-gray-500">LTI事務局アカウントでログインしてください</p>
          </div>

          <form onSubmit={handleLtiLogin} className="space-y-4">
            {ltiLoginError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs font-medium rounded-xl">
                {ltiLoginError}
              </div>
            )}
            
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-700">メールアドレス</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="email"
                  value={ltiEmail}
                  onChange={(e) => setLtiEmail(e.target.value)}
                  placeholder="運営用メールアドレス"
                  className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                  required
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-700">パスワード</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="password"
                  value={ltiPassword}
                  onChange={(e) => setLtiPassword(e.target.value)}
                  placeholder="パスワードを入力"
                  className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold rounded-xl transition-colors shadow-sm text-sm"
            >
              LTI管理画面へログイン
            </button>

            
          </form>
        </div>
      </div>
    );
  }

  // ========================================
  // LTI管理ダッシュボード画面
  // ========================================
  if (step === 'lti-admin') {
    const currentAdminUser = ltiAdminUsers.find(u => u.id === currentLtiAdminId) || {id:profile.id,name:profile.name||'LTI運営',email:'',pass:''};
    const pendingPapers = papers.filter(p => p.status === '承認待ち');
    const publishedPapers = papers.filter(p => p.status === '公開中');

    const handleApprovePaper = (id: number) => {
      setPapers(papers.map(p => p.id === id ? { ...p, status: '公開中', publishedDate: new Date().toISOString().split('T')[0].replace(/-/g, '/') } : p));
    };

    const handleUnpublishPaper = (id: number) => {
      setPapers(papers.map(p => p.id === id ? { ...p, status: '公開停止' } : p));
    };

    const handleUpdateLtiAdminProfile = async (e: React.FormEvent) => {
      e.preventDefault();
      try { await saveMyProfile(editLtiAdminName, editLtiAdminPass); await cloud.reload(); setLtiProfileMessage('プロフィールを更新しました。'); setEditLtiAdminPass(''); }
      catch (error) { setLtiProfileMessage((error as Error).message || '更新できませんでした'); }
    };

    const ltiMenu = [
      { name: 'ホーム', icon: Home },
      { name: '教材管理', icon: FileUp },
      { 
        name: 'コンテンツ管理', 
        icon: FileText, 
        children: ['学会・コンテスト管理', 'お知らせ管理'] 
      },
      { 
        name: '論文管理', 
        icon: BookOpen, 
        children: ['公開申請一覧', '公開済み論文一覧', '特集・ピックアップ管理'] 
      },

      { 
        name: '分析', 
        icon: BarChart3, 
        children: ['ダッシュボード', 'データ分析', '利用状況レポート'] 
      },
      { 
        name: 'システム', 
        icon: Settings, 
        children: ['運営者管理', '設定', '権限管理', 'ヘルプ'] 
      },
    ];

    return (
      <div className="min-h-screen bg-gray-50 flex font-sans text-gray-900">
        <PaperPreviewModal previewPaper={previewPaper} setPreviewPaper={setPreviewPaper} step={step} schoolId={schoolId} paperReplyDraft={paperReplyDraft} setPaperReplyDraft={setPaperReplyDraft} handleSendPaperMessage={handleSendPaperMessage} />
        <RejectPaperModal rejectTargetPaper={rejectTargetPaper} setRejectTargetPaper={setRejectTargetPaper} rejectMessageDraft={rejectMessageDraft} setRejectMessageDraft={setRejectMessageDraft} handleConfirmRejectPaper={handleConfirmRejectPaper} />
        <aside className="w-64 bg-white shadow-sm flex flex-col border-r border-gray-200">
          <div className="h-16 flex items-center px-6 border-b border-gray-200 justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-indigo-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">L</div>
              <span className="text-xl font-extrabold text-gray-900 tracking-tight">LTI Admin</span>
            </div>
          </div>

          <div className="p-4 flex-1 overflow-y-auto space-y-6">
            <div className="flex items-center justify-between px-2">
              <span className="bg-indigo-50 text-indigo-700 text-xs font-bold px-2.5 py-1 rounded-full">
                LTI運営管理者
              </span>
              <button onClick={() => void signOut()} className="text-xs font-bold text-gray-400 hover:text-gray-700 flex items-center gap-1">
                <LogOut className="w-3.5 h-3.5" /> ログアウト
              </button>
            </div>

            <nav className="space-y-4">
              {ltiMenu.map((group) => {
                const Icon = group.icon;
                const isGroupActive = ltiCurrentTab === group.name || (group.children && group.children.includes(ltiCurrentTab));

                return (
                  <div key={group.name} className="space-y-1">
                    <button
                      onClick={() => {
                        if (!group.children) {
                          setLtiCurrentTab(group.name);
                        } else {
                          setLtiCurrentTab(group.children[0]);
                        }
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-bold transition-colors ${
                        isGroupActive && !group.children ? 'bg-indigo-50 text-indigo-700' : 'text-gray-700 hover:bg-gray-100'
                      }`}
                    >
                      {Icon && <Icon className={`h-4 w-4 ${isGroupActive ? 'text-indigo-600' : 'text-gray-400'}`} />}
                      {group.name}
                    </button>

                    {group.children && (
                      <div className="pl-7 space-y-1 pt-1">
                        {group.children.map((child) => {
                          const isChildActive = ltiCurrentTab === child;
                          return (
                            <button
                              key={child}
                              onClick={() => setLtiCurrentTab(child)}
                              className={`w-full text-left px-3 py-2 rounded-lg text-xs font-semibold transition-colors ${
                                isChildActive ? 'bg-indigo-50 text-indigo-700 font-bold' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
                              }`}
                            >
                              {child}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </nav>
          </div>
        </aside>

        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-8 shadow-sm sticky top-0 z-10">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-gray-400">現在位置:</span>
              <span className="text-sm font-bold text-indigo-700 bg-indigo-50 px-3 py-1 rounded-lg">{ltiCurrentTab}</span>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3 border-l pl-4 border-gray-200">
                <div className="w-9 h-9 bg-indigo-100 rounded-full flex items-center justify-center font-bold text-indigo-700 text-sm">
                  {currentAdminUser.name.charAt(0)}
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900">{currentAdminUser.name}</p>
                  <p className="text-xs font-medium text-gray-400">{currentAdminUser.email}</p>
                </div>
              </div>
            </div>
          </header>

          <main className="flex-1 p-8 overflow-y-auto">
            <div className="max-w-7xl mx-auto space-y-8">
              
              {['ダッシュボード','データ分析','利用状況レポート'].includes(ltiCurrentTab) ? (<AdminAnalytics key={ltiCurrentTab} papers={papers} schools={cloud.schools} profiles={cloud.profiles} rows={cloud.rows} reload={cloud.reload} page={ltiCurrentTab}/>) : ltiCurrentTab === 'ホーム' ? (
                <div className="space-y-8">
                  <div>
                    <h1 className="text-2xl font-extrabold text-gray-900">LTI管理ダッシュボードへようこそ</h1>
                    <p className="text-xs font-medium text-gray-500 mt-1">プラットフォーム全体の利用状況および公開申請の管理を行います。</p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                    <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-1">
                      <p className="text-xs font-bold text-gray-400">発行学校ID数 (実数)</p>
                      <p className="text-2xl font-extrabold text-gray-900">{registeredSchoolIds.length} <span className="text-xs font-medium text-gray-500">校</span></p>
                      <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">システムと完全リンク</span>
                    </div>
                    <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-1">
                      <p className="text-xs font-bold text-gray-400">登録生徒数 (全校合計)</p>
                      <p className="text-2xl font-extrabold text-gray-900">{studentsList.length} <span className="text-xs font-medium text-gray-500">名</span></p>
                      <span className="text-[10px] font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded">280名/校 × 4校</span>
                    </div>
                    <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-1">
                      <p className="text-xs font-bold text-gray-400">公開論文数</p>
                      <p className="text-2xl font-extrabold text-indigo-600">{publishedPapers.length} <span className="text-xs font-medium text-gray-500">本</span></p>
                      <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">承認待ち {pendingPapers.length}件</span>
                    </div>
                    <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-1">
                      <p className="text-xs font-bold text-gray-400">配信中の学会・コンテスト</p>
                      <p className="text-2xl font-extrabold text-gray-900">{contests.length} <span className="text-xs font-medium text-gray-500">件</span></p>
                      <span className="text-[10px] font-bold text-gray-500 bg-gray-100 px-2 py-0.5 rounded">募集中</span>
                    </div>
                    <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm space-y-1">
                      <p className="text-xs font-bold text-gray-400">運営アカウント数</p>
                      <p className="text-2xl font-extrabold text-gray-900">{ltiAdminUsers.length} <span className="text-xs font-medium text-gray-500">名</span></p>
                      <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">アクティブ</span>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4 lg:col-span-2">
                      <h3 className="font-bold text-gray-900 text-sm flex items-center gap-2">
                        <CheckCircle2 className="w-4 h-4 text-indigo-600" /> 公開申請一覧（承認待ち論文）
                      </h3>
                      <div className="space-y-3">
                        {pendingPapers.length === 0 ? (
                          <p className="text-xs font-medium text-gray-400 p-6 bg-gray-50 rounded-xl text-center">現在、承認待ちの論文はありません。</p>
                        ) : (
                          pendingPapers.map(paper => (
                            <div key={paper.id} className="p-4 bg-indigo-50/40 rounded-xl border border-indigo-100 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 text-xs">
                              <div className="space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-bold text-indigo-700 bg-indigo-100 px-2 py-0.5 rounded">{paper.field}</span>
                                  <span className="text-gray-400 font-mono">申請日: {paper.submittedDate}</span>
                                </div>
                                <h4 className="font-bold text-sm text-gray-900">{paper.title}{paper.withdrawalRequested&&<span className="ml-2 text-red-700">差し止め申請あり</span>}</h4>
                                <div className="text-gray-600 font-medium space-y-0.5 pt-1">
                                  <p>🏫 申請学校: <span className="font-bold text-gray-800">{paper.schoolName}</span> (ID: <span className="font-mono">{paper.schoolId}</span>)</p>
                                  <p>👨‍🏫 申請教員: <span className="font-bold text-gray-800">{paper.submittedByTeacherName} 先生</span> (ID: <span className="font-mono">{paper.submittedByTeacherId}</span>) / 著者生徒: {paper.author}</p>
                                </div>
                              </div>
                              <div className="flex items-center gap-2 whitespace-nowrap">
                                <button
                                  onClick={() => setPreviewPaper(paper)}
                                  className="px-3.5 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-lg transition-colors flex items-center gap-1"
                                >
                                  <Eye className="w-3.5 h-3.5" /> 中身を確認
                                </button>
                                <button
                                  onClick={() => handleApprovePaper(paper.id)}
                                  className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg transition-colors shadow-sm"
                                >
                                  承認して掲載
                                </button>
                                <button
                                  onClick={() => setRejectTargetPaper(paper)}
                                  className="px-3.5 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-lg transition-colors"
                                >
                                  差し戻し
                                </button>
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <PublishedFields papers={papers} />
                  </div>
                </div>

              ) : ltiCurrentTab === '学会・コンテスト管理' ? (
                /* 【要件②用】LTI運営側：学会・コンテスト配信管理画面 */
                <div className="space-y-6 max-w-4xl">
                  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-1">
                    <h2 className="text-lg font-bold text-gray-900">学会・コンテスト情報の配信管理</h2>
                    <p className="text-xs font-medium text-gray-500">
                      全国高校生の探究コンテストや学会の案内を配信できます。全校一斉公開、または特定の提携校限定の非公開配信を選択可能です。
                    </p>
                  </div>

                  {contestMessage && (
                    <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-xl flex items-center gap-2">
                      <Check className="w-4 h-4" /> {contestMessage}
                    </div>
                  )}

                  {/* コンテスト投稿フォーム */}
                  <form onSubmit={handleCreateContest} className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4">
                    <div className="flex items-center justify-between border-b pb-2">
                      <h3 className="font-bold text-sm text-gray-900">
                        {editingContestId !== null ? '学会・コンテストの編集（再公開）' : '新規学会・コンテストの投稿'}
                      </h3>
                      {editingContestId !== null && (
                        <button type="button" onClick={resetContestForm} className="text-[11px] font-bold text-gray-400 hover:text-gray-600">
                          編集をやめて新規作成に戻る
                        </button>
                      )}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-700">大会・学会タイトル</label>
                        <input
                          type="text"
                          value={newContestTitle}
                          onChange={(e) => setNewContestTitle(e.target.value)}
                          placeholder="例: 全国高校生環境サミット 2026"
                          className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-xs font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                          required
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-700">カテゴリ・分野</label>
                        <input
                          type="text"
                          value={newContestCategory}
                          onChange={(e) => setNewContestCategory(e.target.value)}
                          placeholder="例: 環境科学 / ビジネス / AI"
                          className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-xs font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                          required
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-700">開催日・締切日テキスト（表示用）</label>
                        <input
                          type="text"
                          value={newContestDate}
                          onChange={(e) => setNewContestDate(e.target.value)}
                          placeholder="例: 2026/08/31 締切"
                          className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-xs font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                          required
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-700">締切日（期限切れ判定用・任意）</label>
                        <input
                          type="date"
                          value={newContestDeadlineDate}
                          onChange={(e) => setNewContestDeadlineDate(e.target.value)}
                          className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-xs font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                        />
                        <p className="text-[10px] text-gray-400">設定すると、この日付を過ぎた案内は自動で「期限切れ」と表示されます。</p>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-700">詳細説明・概要</label>
                      <textarea
                        value={newContestDesc}
                        onChange={(e) => setNewContestDesc(e.target.value)}
                        placeholder="コンテストの概要、応募資格、賞品、提出方法などを入力してください。"
                        rows={3}
                        className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-xs font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 resize-none"
                      ></textarea>
                    </div>

                    {/* 公開範囲設定ラジオボタン */}
                    <div className="space-y-2 pt-2 border-t border-gray-100">
                      <label className="text-xs font-bold text-gray-700">配信範囲の選択</label>
                      <div className="flex items-center gap-6">
                        <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-gray-800">
                          <input
                            type="radio"
                            name="targetType"
                            value="all"
                            checked={newContestTargetType === 'all'}
                            onChange={() => setNewContestTargetType('all')}
                            className="text-indigo-600 focus:ring-indigo-500"
                          />
                          <Globe className="w-4 h-4 text-emerald-600" /> 一斉公開 (全校生徒・教員)
                        </label>

                        <label className="flex items-center gap-2 cursor-pointer text-xs font-bold text-gray-800">
                          <input
                            type="radio"
                            name="targetType"
                            value="specific"
                            checked={newContestTargetType === 'specific'}
                            onChange={() => setNewContestTargetType('specific')}
                            className="text-indigo-600 focus:ring-indigo-500"
                          />
                          <LockKeyhole className="w-4 h-4 text-amber-600" /> 特定の学校のみ指定公開
                        </label>
                      </div>

                      {/* 特定校チェックボックス一覧 */}
                      {newContestTargetType === 'specific' && (
                        <div className="p-4 bg-amber-50/60 rounded-xl border border-amber-200/80 space-y-2 mt-2">
                          <p className="text-[11px] font-bold text-amber-900">配信対象の学校IDを選択してください：</p>
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {registeredSchoolIds.map(sId => (
                              <label key={sId} className="flex items-center gap-2 text-xs font-mono font-medium text-gray-800 cursor-pointer bg-white p-2 rounded-lg border border-amber-200">
                                <input
                                  type="checkbox"
                                  value={sId}
                                  checked={newContestTargetSchools.includes(sId)}
                                  onChange={(e) => {
                                    if (e.target.checked) {
                                      setNewContestTargetSchools([...newContestTargetSchools, sId]);
                                    } else {
                                      setNewContestTargetSchools(newContestTargetSchools.filter(id => id !== sId));
                                    }
                                  }}
                                  className="rounded text-indigo-600"
                                />
                                {sId}
                              </label>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    <button
                      type="submit"
                      className="py-2.5 px-5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs shadow-sm flex items-center gap-2"
                    >
                      <Trophy className="w-4 h-4" /> {editingContestId !== null ? 'この内容で更新して再公開する' : '学会・コンテスト情報を配信する'}
                    </button>
                  </form>

                  {/* 配信中のコンテスト一覧 */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-bold text-gray-900">配信中の学会・コンテスト一覧 ({contests.length}件)</h3>
                    <div className="space-y-3">
                      {contests.map(c => {
                        const expired = isContestExpired(c);
                        return (
                        <div key={c.id} className={`bg-white p-5 rounded-2xl border shadow-sm flex items-start justify-between gap-4 ${expired ? 'border-gray-200 opacity-70' : 'border-gray-200'}`}>
                          <div className="space-y-2 flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded">{c.category}</span>
                              <span className="text-xs font-mono text-gray-400">{c.date}</span>
                              {c.targetType === 'all' ? (
                                <span className="text-[10px] font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                                  <Globe className="w-3 h-3" /> 一斉公開
                                </span>
                              ) : (
                                <span className="text-[10px] font-bold bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full flex items-center gap-1">
                                  <LockKeyhole className="w-3 h-3" /> 限定公開 ({c.targetSchoolIds?.join(', ')})
                                </span>
                              )}
                              {expired && (
                                <span className="text-[10px] font-bold bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full flex items-center gap-1">
                                  <Clock className="w-3 h-3" /> 期限切れ
                                </span>
                              )}
                            </div>
                            <h4 className="font-bold text-gray-900 text-sm">{c.title}</h4>
                            <p className="text-xs text-gray-600 leading-relaxed">{c.description}</p>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => handleStartEditContest(c)}
                              className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                              title="編集して再公開"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                            <button
                              onClick={() => handleDeleteContest(c.id)}
                              className="p-2 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                              title="削除"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  </div>
                </div>

              ) : ltiCurrentTab === '公開申請一覧' ? (
                <div className="space-y-6">
                  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-1">
                    <h2 className="text-lg font-bold text-gray-900">論文の公開申請一覧</h2>
                    <p className="text-xs font-medium text-gray-500">まず学校を選択すると、その学校から申請された論文（承認待ち・差し戻し・公開停止）が表示されます。</p>
                  </div>

                  <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm">
                    <label className="text-xs font-bold text-gray-700 block mb-2">対象の学校</label>
                    <select
                      value={ltiManageSchoolId}
                      onChange={(e) => setLtiManageSchoolId(e.target.value)}
                      className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 font-mono"
                    >
                      <option value="">-- 学校を選択してください --</option>
                      {registeredSchoolIds.map(id => (
                        <option key={id} value={id}>{id}</option>
                      ))}
                    </select>
                  </div>

                  {ltiManageSchoolId && (() => {
                    const targetPapers = papers.filter(p => p.schoolId === ltiManageSchoolId && p.status !== '公開中');
                    return (
                      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                        <div className="px-6 py-3 border-b border-gray-200 flex items-center justify-between">
                          <span className="text-xs font-bold text-gray-500">{ltiManageSchoolId} の申請</span>
                          <span className="text-xs font-bold bg-indigo-50 text-indigo-700 px-3 py-1 rounded-xl">全 {targetPapers.length} 件</span>
                        </div>
                        {targetPapers.length === 0 ? (
                          <p className="text-xs text-gray-400 italic p-8 text-center">この学校からの申請中の論文はありません。</p>
                        ) : (
                        <table className="w-full text-left border-collapse text-xs">
                          <thead className="bg-gray-50 border-b border-gray-200 font-bold text-gray-600">
                            <tr>
                              <th className="py-3 px-6">論文タイトル / 分野</th>
                              <th className="py-3 px-6">申請教員 (先生)</th>
                              <th className="py-3 px-6">著者生徒</th>
                              <th className="py-3 px-6">申請日</th>
                              <th className="py-3 px-6">ステータス</th>
                              <th className="py-3 px-6 text-right">操作</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {targetPapers.map((paper) => (
                              <tr key={paper.id} className="hover:bg-gray-50">
                                <td className="py-3.5 px-6">
                                  <p className="font-bold text-gray-900">{paper.title}{paper.withdrawalRequested&&<span className="ml-2 text-red-700">差し止め申請あり</span>}</p>
                                  <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">{paper.field}</span>
                                </td>
                                <td className="py-3.5 px-6 text-gray-700 font-medium">
                                  {paper.submittedByTeacherName} 先生
                                  <p className="text-[10px] font-mono text-gray-400">ID: {paper.submittedByTeacherId}</p>
                                </td>
                                <td className="py-3.5 px-6 text-gray-600">{paper.author}</td>
                                <td className="py-3.5 px-6 font-mono text-gray-500">{paper.submittedDate}</td>
                                <td className="py-3.5 px-6">
                                  <span className={`px-2.5 py-0.5 rounded-full font-bold text-[10px] ${
                                    paper.status === '承認待ち' ? 'bg-amber-100 text-amber-800' :
                                    paper.status === '公開停止' ? 'bg-gray-100 text-gray-700' : 'bg-rose-100 text-rose-800'
                                  }`}>
                                    {paper.status}
                                  </span>
                                </td>
                                <td className="py-3.5 px-6 text-right space-x-1.5">
                                  <button 
                                    onClick={() => setPreviewPaper(paper)} 
                                    className="px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-lg"
                                    title="論文の中身を確認"
                                  >
                                    <Eye className="w-3.5 h-3.5 inline" /> 確認
                                  </button>
                                  {paper.status === '承認待ち' && (
                                    <>
                                      <button onClick={() => handleApprovePaper(paper.id)} className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg shadow-sm">承認</button>
                                      <button onClick={() => setRejectTargetPaper(paper)} className="px-2.5 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-lg">差し戻し</button>
                                    </>
                                  )}
                                  {paper.status === '公開停止' && (
                                    <>
                                      <button onClick={() => handleApprovePaper(paper.id)} className="px-2.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold rounded-lg border border-emerald-200">
                                        再公開
                                      </button>
                                      <button onClick={() => setRejectTargetPaper(paper)} className="px-2.5 py-1.5 bg-gray-200 hover:bg-gray-300 text-gray-700 font-bold rounded-lg">
                                        差し戻し
                                      </button>
                                    </>
                                  )}
                                  {paper.status === '差し戻し' && (
                                    <button onClick={() => handleApprovePaper(paper.id)} className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-lg shadow-sm">承認</button>
                                  )}
                                  {paper.messages && paper.messages.length > 0 && (
                                    <span className="inline-block px-2 py-1 bg-sky-50 text-sky-700 font-bold rounded-lg text-[10px]">💬 {paper.messages.length}</span>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        )}
                      </div>
                    );
                  })()}
                </div>

              ) : ltiCurrentTab === '公開済み論文一覧' ? (
                <div className="space-y-6">
                  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-1">
                    <h2 className="text-lg font-bold text-gray-900">公開済み論文一覧</h2>
                    <p className="text-xs font-medium text-gray-500">まず学校を選択すると、その学校で公開が承認された論文のみが表示されます。</p>
                  </div>

                  <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm">
                    <label className="text-xs font-bold text-gray-700 block mb-2">対象の学校</label>
                    <select
                      value={ltiManageSchoolId}
                      onChange={(e) => setLtiManageSchoolId(e.target.value)}
                      className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 font-mono"
                    >
                      <option value="">-- 学校を選択してください --</option>
                      {registeredSchoolIds.map(id => (
                        <option key={id} value={id}>{id}</option>
                      ))}
                    </select>
                  </div>

                  {ltiManageSchoolId && (() => {
                    const targetPapers = papers.filter(p => p.schoolId === ltiManageSchoolId && p.status === '公開中');
                    return (
                      <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                        <div className="px-6 py-3 border-b border-gray-200 flex items-center justify-between">
                          <span className="text-xs font-bold text-gray-500">{ltiManageSchoolId} の公開済み論文</span>
                          <span className="text-xs font-bold bg-emerald-50 text-emerald-700 px-3 py-1 rounded-xl">全 {targetPapers.length} 件</span>
                        </div>
                        {targetPapers.length === 0 ? (
                          <p className="text-xs text-gray-400 italic p-8 text-center">この学校で公開中の論文はありません。</p>
                        ) : (
                        <table className="w-full text-left border-collapse text-xs">
                          <thead className="bg-gray-50 border-b border-gray-200 font-bold text-gray-600">
                            <tr>
                              <th className="py-3 px-6">論文タイトル / 分野</th>
                              <th className="py-3 px-6">著者生徒</th>
                              <th className="py-3 px-6">公開日</th>
                              <th className="py-3 px-6">閲覧数</th>
                              <th className="py-3 px-6 text-right">操作</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-200">
                            {targetPapers.map((paper) => (
                              <tr key={paper.id} className="hover:bg-gray-50">
                                <td className="py-3.5 px-6">
                                  <p className="font-bold text-gray-900">{paper.title}{paper.withdrawalRequested&&<span className="ml-2 text-red-700">差し止め申請あり</span>}</p>
                                  <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-1.5 py-0.5 rounded">{paper.field}</span>
                                  {paper.isPickedUp && (
                                    <span className="ml-1.5 text-[10px] font-bold text-amber-700 bg-amber-100 px-1.5 py-0.5 rounded">★ ピックアップ中</span>
                                  )}
                                </td>
                                <td className="py-3.5 px-6 text-gray-600">{paper.author}</td>
                                <td className="py-3.5 px-6 font-mono text-gray-500">{paper.publishedDate}</td>
                                <td className="py-3.5 px-6 text-gray-600">{paper.views}</td>
                                <td className="py-3.5 px-6 text-right space-x-1.5">
                                  <button 
                                    onClick={() => setPreviewPaper(paper)} 
                                    className="px-2.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-lg"
                                  >
                                    <Eye className="w-3.5 h-3.5 inline" /> 確認
                                  </button>
                                  <button onClick={() => handleUnpublishPaper(paper.id)} className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold rounded-lg border border-rose-200">
                                    <EyeOff className="w-3.5 h-3.5 inline mr-1" />公開停止
                                  </button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        )}
                      </div>
                    );
                  })()}
                </div>

              ) : ltiCurrentTab === '特集・ピックアップ管理' ? (
                <div className="space-y-6">
                  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-1">
                    <h2 className="text-lg font-bold text-gray-900">特集・ピックアップ管理</h2>
                    <p className="text-xs font-medium text-gray-500">学校を選択し、公開が承認された論文に「ピックアップする」タグを付けられます。</p>
                  </div>

                  <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm">
                    <label className="text-xs font-bold text-gray-700 block mb-2">対象の学校</label>
                    <select
                      value={ltiManageSchoolId}
                      onChange={(e) => setLtiManageSchoolId(e.target.value)}
                      className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 font-mono"
                    >
                      <option value="">-- 学校を選択してください --</option>
                      {registeredSchoolIds.map(id => (
                        <option key={id} value={id}>{id}</option>
                      ))}
                    </select>
                  </div>

                  {ltiManageSchoolId && (() => {
                    const targetPapers = papers.filter(p => p.schoolId === ltiManageSchoolId && p.status === '公開中');
                    return targetPapers.length === 0 ? (
                      <p className="text-xs text-gray-400 italic p-8 text-center bg-white rounded-2xl border border-gray-200">この学校で公開中の論文はありません。</p>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {targetPapers.map((paper) => (
                          <div key={paper.id} className={`bg-white p-5 rounded-2xl border shadow-sm space-y-3 ${paper.isPickedUp ? 'border-amber-300 ring-2 ring-amber-100' : 'border-gray-200'}`}>
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">{paper.field}</span>
                              {paper.isPickedUp && <span className="text-[10px] font-bold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">★ ピックアップ中</span>}
                            </div>
                            <h4 className="font-bold text-gray-900 text-sm leading-snug">{paper.title}{paper.withdrawalRequested&&<span className="ml-2 text-red-700">差し止め申請あり</span>}</h4>
                            <p className="text-xs text-gray-500">著者: {paper.author}</p>
                            <button
                              onClick={() => handleTogglePickup(paper.id)}
                              className={`w-full py-2 rounded-xl text-xs font-bold transition-colors ${
                                paper.isPickedUp
                                  ? 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                  : 'bg-amber-500 hover:bg-amber-600 text-white shadow-sm'
                              }`}
                            >
                              {paper.isPickedUp ? 'ピックアップを解除する' : '★ ピックアップする'}
                            </button>
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </div>

              ) : ltiCurrentTab === '学校管理' ? (
                <div className="space-y-6">
                  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-1">
                    <h2 className="text-lg font-bold text-gray-900">学校管理</h2>
                    <p className="text-xs font-medium text-gray-500">発行済みの学校IDを選択すると、その学校に登録されている先生・生徒を確認できます（氏名は各自の設定変更がそのまま反映されます）。</p>
                  </div>

                  <div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm">
                    <label className="text-xs font-bold text-gray-700 block mb-2">発行済みの学校ID（全{registeredSchoolIds.length}校）</label>
                    <div className="flex flex-wrap gap-2">
                      {registeredSchoolIds.map(id => (
                        <button
                          key={id}
                          onClick={() => setLtiManageSchoolId(id)}
                          className={`px-3.5 py-2 rounded-xl text-xs font-bold font-mono border transition-colors ${
                            ltiManageSchoolId === id
                              ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                              : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
                          }`}
                        >
                          {id}
                        </button>
                      ))}
                    </div>
                  </div>

                  {ltiManageSchoolId && (() => {
                    const schoolTeachersView = teachersList.filter(t => t.schoolId === ltiManageSchoolId);
                    const schoolStudentsView = studentsList.filter(s => s.schoolId === ltiManageSchoolId);
                    return (
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                          <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
                            <span className="text-xs font-bold text-gray-700">先生一覧</span>
                            <span className="text-[10px] font-bold bg-orange-50 text-orange-700 px-2.5 py-1 rounded-lg">全{schoolTeachersView.length}名</span>
                          </div>
                          <div className="max-h-[500px] overflow-y-auto">
                            <table className="w-full text-left border-collapse text-xs">
                              <thead className="bg-gray-50 border-b border-gray-200 font-bold text-gray-500 sticky top-0">
                                <tr>
                                  <th className="py-2.5 px-5">教員ID</th>
                                  <th className="py-2.5 px-5">氏名（現在）</th>
                                  <th className="py-2.5 px-5">担当</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {schoolTeachersView.map(t => (
                                  <tr key={t.id}>
                                    <td className="py-2.5 px-5 font-mono font-bold text-gray-800">{t.id}</td>
                                    <td className="py-2.5 px-5 font-bold text-gray-900">{t.name} 先生</td>
                                    <td className="py-2.5 px-5 text-gray-500">{t.dept}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>

                        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                          <div className="px-5 py-3 border-b border-gray-200 flex items-center justify-between">
                            <span className="text-xs font-bold text-gray-700">生徒一覧</span>
                            <span className="text-[10px] font-bold bg-orange-50 text-orange-700 px-2.5 py-1 rounded-lg">全{schoolStudentsView.length}名</span>
                          </div>
                          <div className="max-h-[500px] overflow-y-auto">
                            <table className="w-full text-left border-collapse text-xs">
                              <thead className="bg-gray-50 border-b border-gray-200 font-bold text-gray-500 sticky top-0">
                                <tr>
                                  <th className="py-2.5 px-5">生徒ID</th>
                                  <th className="py-2.5 px-5">氏名（現在）</th>
                                  <th className="py-2.5 px-5">クラス</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {schoolStudentsView.map(s => (
                                  <tr key={s.id}>
                                    <td className="py-2.5 px-5 font-mono font-bold text-gray-800">{s.id}</td>
                                    <td className="py-2.5 px-5 font-bold text-gray-900">{s.name}</td>
                                    <td className="py-2.5 px-5 text-gray-500">{s.class}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>

              ) : ltiCurrentTab === '運営者管理' ? (
                <div className="space-y-6 max-w-2xl">
                  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-1">
                    <h2 className="text-lg font-bold text-gray-900">LTI 運営者管理</h2>
                    <p className="text-xs font-medium text-gray-500">運営アカウントの表示名前やパスワードを変更できます。（運営アカウント数: 全{ltiAdminUsers.length}個）</p>
                  </div>

                  {ltiProfileMessage && (
                    <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-xl flex items-center gap-2">
                      <Check className="w-4 h-4" /> {ltiProfileMessage}
                    </div>
                  )}

                  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-6">
                    <div className="space-y-2">
                      <label className="text-xs font-bold text-gray-700">編集対象のアカウント切り替え</label>
                      <div className="grid grid-cols-2 gap-3">
                        {ltiAdminUsers.map(user => (
                          <button
                            key={user.id}
                            type="button"
                            onClick={() => {
                              setCurrentLtiAdminId(user.id);
                              setEditLtiAdminName(user.name);
                              setEditLtiAdminPass('');
                            }}
                            className={`p-3 rounded-xl border text-left transition-all ${user.id === currentLtiAdminId ? 'border-indigo-600 bg-indigo-50/50 ring-2 ring-indigo-500/20' : 'border-gray-200 hover:bg-gray-50'}`}
                          >
                            <p className="font-bold text-xs text-gray-900">{user.name}</p>
                            <p className="text-[10px] text-gray-400 font-mono">{user.email}</p>
                          </button>
                        ))}
                      </div>
                    </div>

                    <form onSubmit={handleUpdateLtiAdminProfile} className="space-y-4 pt-4 border-t border-gray-100">
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-700">メールアドレス（ログインID / 変更不可）</label>
                        <input
                          type="text"
                          value={currentAdminUser.email}
                          disabled
                          className="w-full px-4 py-2.5 bg-gray-100 border border-gray-300 rounded-xl text-xs font-medium text-gray-500 cursor-not-allowed font-mono"
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-700">運営者表示名前</label>
                        <input
                          type="text"
                          value={editLtiAdminName}
                          onChange={(e) => setEditLtiAdminName(e.target.value)}
                          placeholder="例: LTI 統括管理者"
                          className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-xs font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                          required
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-700">新しいパスワード (変更時のみ入力)</label>
                        <input
                          type="password"
                          value={editLtiAdminPass}
                          onChange={(e) => setEditLtiAdminPass(e.target.value)}
                          placeholder="変更しない場合は空欄のまま"
                          className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-xs font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                        />
                      </div>

                      <button
                        type="submit"
                        className="py-2.5 px-5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs shadow-sm"
                      >
                        変更内容を保存する
                      </button>
                    </form>
                  </div>
                </div>

              ) : ltiCurrentTab === '教材管理' ? (
                <div className="space-y-6 max-w-4xl">
                  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-1">
                    <h2 className="text-lg font-bold text-gray-900">学校別オーダーメイド教材の管理</h2>
                    <p className="text-xs font-medium text-gray-500">画像を1枚ずつ追加して、Webサイトのようにスライドしていくオンライン教材を作成できます。生徒・教員は自分の学校分のみ閲覧できます。</p>
                  </div>

                  <div className="bg-amber-50 border border-amber-200 text-amber-800 text-xs font-bold rounded-xl p-3.5">
                    ※ 教材画像はデータベースに保存します。1教材の合計サイズは約2MB以内に抑えてください。
                  </div>

                  {materialMessage && (
                    <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-xl flex items-center gap-2">
                      <Check className="w-4 h-4" /> {materialMessage}
                    </div>
                  )}

                  <form onSubmit={handleUploadMaterial} className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-700">対象の学校</label>
                      <select
                        value={materialSchoolId}
                        onChange={(e) => setMaterialSchoolId(e.target.value)}
                        className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 font-mono"
                      >
                        {registeredSchoolIds.map(id => (
                          <option key={id} value={id}>{id}</option>
                        ))}
                      </select>
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-700">教材タイトル</label>
                      <input
                        type="text"
                        value={newMaterialTitle}
                        onChange={(e) => setNewMaterialTitle(e.target.value)}
                        placeholder="例: ○○高校 探究テーマ設定ガイド"
                        className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                        required
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-700">説明・補足</label>
                      <textarea
                        value={newMaterialDesc}
                        onChange={(e) => setNewMaterialDesc(e.target.value)}
                        placeholder="教材の内容や使い方を記入してください。"
                        rows={3}
                        className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 resize-none"
                      ></textarea>
                    </div>

                    <div className="space-y-2 pt-2 border-t border-gray-100">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-gray-700">スライド（画像）</label>
                        <span className="text-[10px] text-gray-400 font-mono">{draftSlides.length} 枚</span>
                      </div>

                      <div className="border-2 border-dashed border-gray-300 hover:border-indigo-400 rounded-xl p-5 text-center bg-gray-50 transition-colors relative cursor-pointer">
                        <input
                          type="file"
                          accept="image/*"
                          onChange={(e) => {
                            handleAddMaterialSlideImage(e.target.files?.[0] || null);
                            e.target.value = '';
                          }}
                          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                        />
                        <div className="space-y-1 pointer-events-none">
                          <Upload className="w-6 h-6 text-indigo-500 mx-auto" />
                          <p className="text-xs font-bold text-gray-700">クリックまたはドラッグ＆ドロップで画像を1枚追加</p>
                          <p className="text-[10px] text-gray-400">追加した順にスライドとして並びます。複数回選択して枚数を増やせます。</p>
                        </div>
                      </div>

                      {draftSlides.length > 0 && (
                        <div className="space-y-2 pt-2">
                          {draftSlides.map((slide, idx) => (
                            <div key={slide.id} className="flex items-start gap-3 p-3 bg-gray-50 border border-gray-200 rounded-xl">
                              <img src={slide.imageUrl} alt={`スライド${idx + 1}`} className="w-20 h-14 object-cover rounded-lg border border-gray-200 shrink-0" />
                              <div className="flex-1 space-y-1.5 min-w-0">
                                <p className="text-[10px] font-bold text-gray-400">スライド {idx + 1}</p>
                                <input
                                  type="text"
                                  value={slide.caption}
                                  onChange={(e) => updateDraftSlideCaption(slide.id, e.target.value)}
                                  placeholder="このスライドのキャプション（任意）"
                                  className="w-full px-3 py-1.5 bg-white border border-gray-300 rounded-lg text-xs font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                                />
                              </div>
                              <div className="flex flex-col items-center gap-1 shrink-0">
                                <button type="button" onClick={() => moveDraftSlide(slide.id, 'up')} disabled={idx === 0} className="p-1 text-gray-400 hover:text-indigo-600 disabled:opacity-20 disabled:cursor-not-allowed">
                                  <ChevronRight className="w-3.5 h-3.5 -rotate-90" />
                                </button>
                                <button type="button" onClick={() => moveDraftSlide(slide.id, 'down')} disabled={idx === draftSlides.length - 1} className="p-1 text-gray-400 hover:text-indigo-600 disabled:opacity-20 disabled:cursor-not-allowed">
                                  <ChevronRight className="w-3.5 h-3.5 rotate-90" />
                                </button>
                                <button type="button" onClick={() => removeDraftSlide(slide.id)} className="p-1 text-gray-400 hover:text-rose-600">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>

                    <button
                      type="submit"
                      disabled={!newMaterialTitle.trim() || draftSlides.length === 0}
                      className="w-full py-3 px-4 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl text-sm transition-colors shadow-sm"
                    >
                      この学校に教材をアップロードする
                    </button>
                  </form>

                  <div className="space-y-3">
                    <h3 className="text-sm font-bold text-gray-900">アップロード済み教材一覧</h3>
                    {teachingMaterials.length === 0 ? (
                      <p className="text-xs font-medium text-gray-400 italic p-4 bg-gray-50 rounded-xl text-center">まだ教材がアップロードされていません。</p>
                    ) : (
                      <div className="space-y-3">
                        {teachingMaterials.map(mat => (
                          <div key={mat.id} className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex items-start justify-between gap-4">
                            <div className="flex items-start gap-3 flex-1 min-w-0">
                              {mat.slides && mat.slides.length > 0 && (
                                <img src={mat.slides[0].imageUrl} alt="" className="w-16 h-16 object-cover rounded-lg border border-gray-200 shrink-0" />
                              )}
                              <div className="space-y-1 min-w-0">
                                <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded font-mono">{mat.schoolId}</span>
                                <h4 className="font-bold text-gray-900 text-sm">{mat.title}</h4>
                                <p className="text-xs text-gray-500">{mat.description}</p>
                                <p className="text-[11px] text-gray-400 font-mono flex items-center gap-1">
                                  <BookOpen className="w-3.5 h-3.5 text-indigo-400" /> {mat.slides?.length || 0} 枚のスライド ・ {mat.uploadedAt}
                                </p>
                              </div>
                            </div>
                            <button
                              onClick={() => handleDeleteMaterial(mat.id)}
                              className="p-2 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors shrink-0"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

              ) : ltiCurrentTab === 'お知らせ管理' ? (
                <div className="space-y-6 max-w-3xl">
                  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-1">
                    <h2 className="text-lg font-bold text-gray-900">お知らせの配信管理</h2>
                    <p className="text-xs font-medium text-gray-500">ここで発信したお知らせは、全学校の生徒・教員のホーム画面に表示されます。</p>
                  </div>

                  {noticeMessage && (
                    <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-xl flex items-center gap-2">
                      <Check className="w-4 h-4" /> {noticeMessage}
                    </div>
                  )}

                  <form onSubmit={handleSaveNotice} className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4">
                    <div className="flex items-center justify-between border-b pb-2">
                      <h3 className="font-bold text-sm text-gray-900">
                        {editingNoticeId !== null ? 'お知らせの編集' : '新規お知らせの作成'}
                      </h3>
                      {editingNoticeId !== null && (
                        <button type="button" onClick={resetNoticeForm} className="text-[11px] font-bold text-gray-400 hover:text-gray-600">
                          編集をやめて新規作成に戻る
                        </button>
                      )}
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-700">タイトル</label>
                      <input
                        type="text"
                        value={newNoticeTitle}
                        onChange={(e) => setNewNoticeTitle(e.target.value)}
                        placeholder="例: 夏季LTI講評会エントリー受付開始のお知らせ"
                        className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600"
                        required
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-700">内容</label>
                      <textarea
                        value={newNoticeContent}
                        onChange={(e) => setNewNoticeContent(e.target.value)}
                        placeholder="お知らせの本文を入力してください。"
                        rows={4}
                        className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-600 resize-none"
                      ></textarea>
                    </div>

                    <button
                      type="submit"
                      className="py-2.5 px-5 bg-indigo-600 hover:bg-indigo-700 text-white font-bold rounded-xl text-xs shadow-sm flex items-center gap-2"
                    >
                      <Send className="w-4 h-4" /> {editingNoticeId !== null ? 'この内容で更新する' : 'お知らせを配信する'}
                    </button>
                  </form>

                  <div className="space-y-3">
                    <h3 className="text-sm font-bold text-gray-900">配信済みのお知らせ一覧 ({notices.length}件)</h3>
                    {notices.length === 0 ? (
                      <p className="text-xs font-medium text-gray-400 italic p-4 bg-gray-50 rounded-xl text-center">まだお知らせはありません。</p>
                    ) : (
                      <div className="space-y-3">
                        {notices.map(n => (
                          <div key={n.id} className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex items-start justify-between gap-4">
                            <div className="space-y-1 flex-1">
                              <span className="text-[10px] font-mono text-gray-400">{n.date}</span>
                              <h4 className="font-bold text-gray-900 text-sm">{n.title}</h4>
                              <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap">{n.content}</p>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => handleStartEditNotice(n)}
                                className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-colors"
                                title="編集"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                              <button
                                onClick={() => handleDeleteNotice(n.id)}
                                className="p-2 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                                title="削除"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

              ) : (
                <div className="bg-white p-12 rounded-2xl border border-gray-200 shadow-sm text-center space-y-3">
                  <h2 className="text-lg font-bold text-gray-900">{ltiCurrentTab} 管理画面</h2>
                  <p className="text-xs text-gray-500">現在「{ltiCurrentTab}」の機能モジュールが選択されています。</p>
                </div>
              )}

            </div>
          </main>
        </div>
      </div>
    );
  }

  // ----------------------------------------
  // 学校ID入力画面
  // ----------------------------------------
  const handleSchoolSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSchoolError('');
    if (!inputSchoolId.trim()) {
      setSchoolError('学校IDを入力してください。');
      return;
    }
    if (registeredSchoolIds.includes(inputSchoolId)) {
      setSchoolId(inputSchoolId);
      setStep('role-select');
    } else {
      setSchoolError('指定された学校IDが見つかりません。');
    }
  };

  if (step === 'school-input') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center font-sans p-4 text-gray-900">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-8 space-y-6">
          <div className="flex items-center justify-between">
            <button onClick={() => void signOut()} className="text-xs font-bold text-gray-500 hover:text-gray-900 flex items-center gap-1">
              <ArrowLeft className="w-4 h-4" /> ログイン方法選択へ戻る
            </button>
          </div>

          <div className="text-center space-y-2">
            <div className="w-12 h-12 bg-emerald-600 rounded-xl mx-auto flex items-center justify-center text-white font-bold text-xl shadow-sm">L</div>
            <h1 className="text-2xl font-bold text-gray-900">学校ログイン</h1>
            <p className="text-sm font-medium text-gray-500">学校IDを入力してシステムに接続してください</p>
          </div>

          <form onSubmit={handleSchoolSubmit} className="space-y-4">
            {schoolError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs font-medium rounded-xl">
                {schoolError}
              </div>
            )}
            
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-700">学校ID (テナントコード)</label>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={inputSchoolId}
                  onChange={(e) => setInputSchoolId(e.target.value)}
                  placeholder="学校ID"
                  className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 font-mono"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl transition-colors shadow-sm text-sm"
            >
              次へ進む
            </button>

            <div className="pt-2 text-center space-y-1">
              
            </div>
          </form>
        </div>
      </div>
    );
  }

  // ----------------------------------------
  // ロール選択画面
  // ----------------------------------------
  if (step === 'role-select') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center font-sans p-4 text-gray-900">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-8 space-y-6">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setStep('school-input')}
              className="text-xs font-bold text-gray-500 hover:text-gray-900 flex items-center gap-1"
            >
              <ArrowLeft className="w-4 h-4" /> 学校ID変更
            </button>
            <span className="text-xs font-mono font-bold bg-gray-100 text-gray-700 px-2.5 py-1 rounded-full">
              {schoolId}
            </span>
          </div>

          <div className="text-center space-y-1">
            <h1 className="text-xl font-bold text-gray-900">アカウント種類の選択</h1>
            <p className="text-xs font-medium text-gray-500">ログインする権限を選んでください</p>
          </div>

          <div className="space-y-3 pt-2">
            <button
              onClick={() => {
                setSelectedRole('teacher');
                setInputLoginId('LTI.teacher.001');
                setInputPassword('');
                setLoginError('');
                setStep('login-form');
              }}
              className="w-full flex items-center justify-center gap-3 py-4 px-5 bg-orange-400 hover:bg-orange-500 text-white font-semibold rounded-xl transition-colors shadow-sm text-sm"
            >
              <UserCheck className="w-5 h-5" /> 教師としてログイン
            </button>

            <button
              onClick={() => {
                setSelectedRole('student');
                setInputLoginId(`${schoolId}.student.001`);
                setInputPassword('');
                setLoginError('');
                setStep('login-form');
              }}
              className="w-full flex items-center justify-center gap-3 py-4 px-5 bg-emerald-600 hover:bg-emerald-700 text-white font-semibold rounded-xl transition-colors shadow-sm text-sm"
            >
              <User className="w-5 h-5" /> 生徒としてログイン
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ----------------------------------------
  // ID・パスワード入力画面
  // ----------------------------------------
  const handleLogin = (e: React.FormEvent) => { e.preventDefault(); void signOut(); };

  if (step === 'login-form') {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center font-sans p-4 text-gray-900">
        <div className="max-w-md w-full bg-white rounded-2xl shadow-sm border border-gray-200 p-8 space-y-6">
          <div className="flex items-center justify-between">
            <button
              onClick={() => setStep('role-select')}
              className="text-xs font-bold text-gray-500 hover:text-gray-900 flex items-center gap-1"
            >
              <ArrowLeft className="w-4 h-4" /> 選択画面に戻る
            </button>
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${selectedRole === 'teacher' ? 'bg-orange-50 text-orange-700' : 'bg-emerald-100 text-emerald-800'}`}>
              {selectedRole === 'teacher' ? '教師ログイン' : '生徒ログイン'}
            </span>
          </div>

          <div className="text-center space-y-1">
            <h1 className="text-xl font-bold text-gray-900">IDとパスワードの入力</h1>
            <p className="text-xs font-medium text-gray-500">
              学校ID: <span className="font-mono font-bold text-gray-900">{schoolId}</span>
            </p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            {loginError && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 text-xs font-medium rounded-xl leading-relaxed">
                {loginError}
              </div>
            )}
            
            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-700">ログインID</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="text"
                  value={inputLoginId}
                  onChange={(e) => setInputLoginId(e.target.value)}
                  placeholder={selectedRole === 'teacher' ? 'LTI.teacher.001' : `${schoolId}.student.001`}
                  className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 font-mono"
                  required
                />
              </div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-bold text-gray-700">パスワード</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input
                  type="password"
                  value={inputPassword}
                  onChange={(e) => setInputPassword(e.target.value)}
                  placeholder="パスワードを入力"
                  className="w-full pl-9 pr-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                  required
                />
              </div>
            </div>

            <button
              type="submit"
              className={`w-full py-3 px-4 text-white font-semibold rounded-xl transition-colors shadow-sm text-sm ${selectedRole === 'teacher' ? 'bg-orange-400 hover:bg-orange-500' : 'bg-emerald-600 hover:bg-emerald-700'}`}
            >
              ログインする
            </button>

            <div className="pt-2 text-center">
              <p className="text-xs font-medium text-gray-400">
                初期パスワード: <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-700 font-bold"></code>
              </p>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // ----------------------------------------
  // 教師用画面
  // ----------------------------------------
  if (step === 'teacher') {
    const loggedInTeacher = teachersList.find(t => t.id === currentTeacherId && t.schoolId === schoolId) || { id: currentTeacherId, name: '教員', dept: '', pass: '', schoolId: schoolId };

    const schoolStudents = studentsList.filter(s => s.schoolId === schoolId);
    const schoolTeachers = teachersList.filter(t => t.schoolId === schoolId);
    const schoolAssignments = assignments.filter(a => a.schoolId === schoolId);
    const schoolMaterials = teachingMaterials.filter(m => m.schoolId === schoolId);
    const publishedList = papers.filter(p => p.status === '公開中');

    // 教員側で閲覧可能なコンテスト（一斉公開 または 自校が指定された公開）
    const visibleContests = contests.filter(c => c.targetType === 'all' || (c.targetSchoolIds && c.targetSchoolIds.includes(schoolId)));

    const handleTeacherProfileUpdate = async (e: React.FormEvent) => {
      e.preventDefault();
      try { await saveMyProfile(editTeacherName, teacherNewPass); await cloud.reload(); setTeacherProfileMessage('プロフィールを更新しました。'); setTeacherNewPass(''); }
      catch (error) { setTeacherProfileMessage((error as Error).message || '更新できませんでした'); }
    };

    const handleTeacherSubmitPaper = async (e: React.FormEvent) => {
      e.preventDefault();
      if (!teacherPaperTitle.trim() || !teacherPaperAuthor.trim()) return;

      let storagePath: string | undefined=editingPaper?.storagePath;
      try { if (teacherPaperFile) storagePath = await uploadPdf(teacherPaperFile); } catch (error) { setTeacherApplyMessage((error as Error).message); return; }
      const newPaper: PublicPaper = {
        storagePath,
        id: Date.now(),
        title: teacherPaperTitle,
        schoolName: cloud.schools.find(s => s.id === schoolId)?.name || schoolId,
        schoolId: schoolId,
        submittedByTeacherName: loggedInTeacher.name,
        submittedByTeacherId: loggedInTeacher.id,
        field: teacherPaperField,
        publishedDate: '',
        views: 0,
        author: teacherPaperAuthor,
        status: '承認待ち',
        submittedDate: new Date().toISOString().split('T')[0].replace(/-/g, '/'),
        fileName: teacherPaperFile?.name,
        abstract: teacherPaperAbstract.trim() || '（要旨未記入）'
      };

      setPapers(editingPaper?papers.map(p=>p.id===editingPaper.id?{...p,...newPaper,id:p.id,storagePath:storagePath||p.storagePath,fileName:teacherPaperFile?.name||p.fileName}:p):[newPaper,...papers]);
      setEditingPaper(null);
      setTeacherApplyMessage('LTIへ論文の公開申請を送信しました！事務局の審査完了までお待ちください。');
      setTeacherPaperTitle('');
      setTeacherPaperAuthor('');
      setTeacherPaperAbstract('');
      setTeacherPaperFile(null);
      setTimeout(() => setTeacherApplyMessage(''), 5000);
    };

    // ----------------------------------------
    // AI添削（Wordドロップ→AIが修正点・アドバイス・追加実験の方向性を指摘→生徒に送信）
    // ※現時点ではフロントのみ。/api/ai-paper-review はSupabase移行時に実装予定。
    //   バックエンド未接続の間は各項目が「準備中」エラーになるが、その場で手動編集して
    //   送信フローそのものは今から確認できるようにしてある。
    // ----------------------------------------

    // Wordファイル1件をAIに送り、修正点・アドバイス・追加実験の方向性を取得する
    const requestAiPaperReview = async (_file: File): Promise<{ title?: string } & AiReviewResult> => {
      throw new Error('AI連携は未設定です。ファイルはAIへ送信していません。');
    };

    // 複数のWordファイルをドロップ/選択したら、1件ずつAI添削をリクエストする
    const handleAiReviewFilesSelected = async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const fileArray = Array.from(files).filter(f => /\.docx$/i.test(f.name));
      if (fileArray.length === 0) return;

      const initialItems: AiReviewItem[] = fileArray.map((f, i) => ({
        id: `${Date.now()}-${i}-${f.name}`,
        fileName: f.name,
        paperTitle: f.name.replace(/\.docx$/i, ''),
        status: 'processing',
        result: { corrections: [], advice: [], nextExperiments: [] },
        studentId: '',
        note: '',
        sent: false,
      }));
      setAiReviewItems(prev => [...initialItems, ...prev]);

      for (let i = 0; i < fileArray.length; i++) {
        const itemId = initialItems[i].id;
        try {
          const res = await requestAiPaperReview(fileArray[i]);
          setAiReviewItems(prev => prev.map(it => it.id === itemId ? {
            ...it,
            status: 'done',
            paperTitle: res.title || it.paperTitle,
            result: {
              corrections: res.corrections || [],
              advice: res.advice || [],
              nextExperiments: res.nextExperiments || [],
            },
          } : it));
        } catch (err: any) {
          setAiReviewItems(prev => prev.map(it => it.id === itemId ? {
            ...it,
            status: 'error',
            error: 'AI添削はまだ準備中です（バックエンド実装後に利用可能になります）。内容は手動で入力・編集して送信フローを確認できます。',
          } : it));
        }
      }
    };

    const updateAiReviewItem = (id: string, patch: Partial<AiReviewItem>) => {
      setAiReviewItems(prev => prev.map(it => it.id === id ? { ...it, ...patch } : it));
    };

    const updateAiReviewResultField = (id: string, field: keyof AiReviewResult, text: string) => {
      const lines = text.split('\n');
      setAiReviewItems(prev => prev.map(it => it.id === id ? { ...it, result: { ...it.result, [field]: lines } } : it));
    };

    const removeAiReviewItem = (id: string) => {
      setAiReviewItems(prev => prev.filter(it => it.id !== id));
    };

    // 添削結果を、選択した生徒宛にメッセージとして送信する
    const handleSendAiReviewToStudent = (item: AiReviewItem) => {
      if (!item.studentId) return;
      const hasContent = item.result.corrections.some(l => l.trim()) || item.result.advice.some(l => l.trim()) || item.result.nextExperiments.some(l => l.trim());
      if (!hasContent) return;

      const cleanResult: AiReviewResult = {
        corrections: item.result.corrections.map(l => l.trim()).filter(Boolean),
        advice: item.result.advice.map(l => l.trim()).filter(Boolean),
        nextExperiments: item.result.nextExperiments.map(l => l.trim()).filter(Boolean),
      };

      const newMessage: StudentFeedbackMessage = {
        id: Date.now(),
        schoolId: schoolId,
        studentId: item.studentId,
        teacherName: loggedInTeacher.name,
        paperTitle: item.paperTitle,
        fileName: item.fileName,
        result: cleanResult,
        note: item.note.trim(),
        sentAt: new Date().toLocaleString('ja-JP'),
        read: false,
      };

      setStudentFeedbackMessages([newMessage, ...studentFeedbackMessages]);
      updateAiReviewItem(item.id, { sent: true });
    };

    const teacherMenuBase = [
      { name: 'ホーム', icon: Home },
      { name: '学会・コンテスト', icon: Trophy },
      { name: 'みんなの論文', icon: BookOpen },
      { name: '教材', icon: FileUp },
      { name: '課題配信', icon: FileText },
      { name: '進捗管理', icon: BarChart3 },
      { name: '探究論文の公開申請', icon: FileUp },
      { name: 'AI添削', icon: Bot },


      { name: 'アカウント設定', icon: UserCog },
    ];
    const teacherMenuNames = reconcileMenuOrder(teacherMenuOrder, teacherMenuBase.map(m => m.name));
    const teacherMenu = teacherMenuNames
      .map(name => teacherMenuBase.find(m => m.name === name))
      .filter((m): m is typeof teacherMenuBase[number] => !!m);

    return (
      <div className="min-h-screen bg-gray-50 flex font-sans text-gray-900">
        <PaperPreviewModal previewPaper={previewPaper} setPreviewPaper={setPreviewPaper} step={step} schoolId={schoolId} paperReplyDraft={paperReplyDraft} setPaperReplyDraft={setPaperReplyDraft} handleSendPaperMessage={handleSendPaperMessage} />
        <PdfPreviewModal previewPdfModalData={previewPdfModalData} setPreviewPdfModalData={setPreviewPdfModalData} />
        <MaterialPreviewModal previewMaterialModalData={previewMaterialModalData} setPreviewMaterialModalData={setPreviewMaterialModalData} />
        <aside className="w-64 bg-white shadow-sm flex flex-col border-r border-gray-200">
          <div className="h-16 flex items-center px-6 border-b border-gray-200 justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-orange-400 rounded-lg flex items-center justify-center text-white font-bold text-sm">L</div>
              <span className="text-xl font-extrabold text-gray-900 tracking-tight">LTI Explore</span>
            </div>
          </div>
          
          <div className="px-6 py-3 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
            <Building2 className="w-3.5 h-3.5 text-gray-400" />
            <span className="text-xs font-mono font-bold text-gray-600 truncate">{schoolId}</span>
          </div>

          <div className="p-4 flex-1 overflow-y-auto">
            <div className="flex items-center justify-between mb-4 px-2">
              <span className="bg-orange-50 text-orange-700 text-xs font-bold px-2.5 py-1 rounded-full">
                教員モード
              </span>
              <button onClick={() => void signOut()} className="text-xs font-bold text-gray-400 hover:text-gray-700 flex items-center gap-1">
                <LogOut className="w-3.5 h-3.5" /> ログアウト
              </button>
            </div>

            <nav className="space-y-1">
              {teacherMenu.map((item) => {
                const Icon = item.icon;
                const isActive = currentTab === item.name;
                const isDragging = draggedTabName === item.name;
                return (
                  <button
                    key={item.name}
                    draggable
                    onDragStart={() => handleTabDragStart(item.name)}
                    onDragOver={handleTabDragOver}
                    onDrop={() => handleTabDrop(item.name, teacherMenuOrder, setTeacherMenuOrder, teacherMenuBase.map(m => m.name))}
                    onDragEnd={() => setDraggedTabName(null)}
                    onClick={() => {
                      setCurrentTab(item.name);
                      if (item.name !== '課題配信') {
                        setEditingAssignmentId(null);
                        setNewAssignTitle('');
                        setNewAssignDeadline('');
                        setNewAssignDesc('');
                      }
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors cursor-grab active:cursor-grabbing ${
                      isActive ? 'bg-orange-50 text-orange-800 font-bold' : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                    } ${isDragging ? 'opacity-30' : ''}`}
                  >
                    <GripVertical className="h-3.5 w-3.5 text-gray-300 shrink-0" />
                    {Icon && <Icon className={`h-5 w-5 shrink-0 ${isActive ? 'text-orange-500' : 'text-gray-400'}`} />}
                    <span className="truncate">{item.name}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </aside>

        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-8 shadow-sm sticky top-0 z-10">
            <div className="flex items-center gap-4 w-96">
              <div className="relative w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="検索..."
                  className="w-full pl-9 pr-4 py-1.5 bg-gray-50 border border-gray-300 rounded-lg text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400/20 focus:border-orange-400"
                />
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3 border-l pl-4 border-gray-200">
                <div className="w-9 h-9 bg-orange-50 rounded-full flex items-center justify-center font-bold text-orange-600 text-sm">
                  {loggedInTeacher.name.charAt(0)}
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900">{loggedInTeacher.name} 先生</p>
                  <p className="text-xs font-medium text-gray-400">ID: {loggedInTeacher.id}</p>
                </div>
              </div>
            </div>
          </header>

          <main className="flex-1 p-8 overflow-y-auto">
            <div className="max-w-7xl mx-auto space-y-6">

              {currentTab === 'ホーム' ? (
                <div className="space-y-6">
                  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-2">
                    <h1 className="text-xl font-extrabold text-gray-900">先生用 ポータルホーム</h1>
                    <p className="text-xs font-medium text-gray-500">探究学習の進捗確認や課題配信を行えます。</p>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="p-5 bg-white rounded-2xl border border-gray-200 shadow-sm space-y-1">
                      <p className="text-xs font-bold text-gray-400">配信中課題</p>
                      <p className="text-2xl font-extrabold text-gray-900">{schoolAssignments.length} <span className="text-xs font-medium text-gray-500">件</span></p>
                    </div>
                    <div className="p-5 bg-white rounded-2xl border border-gray-200 shadow-sm space-y-1">
                      <p className="text-xs font-bold text-gray-400">校内登録生徒数</p>
                      <p className="text-2xl font-extrabold text-gray-900">{schoolStudents.length} <span className="text-xs font-medium text-gray-500">名</span></p>
                    </div>
                    <div className="p-5 bg-white rounded-2xl border border-gray-200 shadow-sm space-y-1">
                      <p className="text-xs font-bold text-gray-400">一般公開中論文</p>
                      <p className="text-2xl font-extrabold text-orange-600">{publishedList.length} <span className="text-xs font-medium text-gray-500">本</span></p>
                    </div>
                  </div>

                  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4">
                    <h3 className="font-bold text-sm text-gray-900 flex items-center gap-1.5">📢 LTI運営からのお知らせ</h3>
                    {notices.length === 0 ? (
                      <p className="text-xs text-gray-400 italic">現在お知らせはありません。</p>
                    ) : (
                      <div className="space-y-3">
                        {notices.map(n => (
                          <div key={n.id} className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                            <div className="flex items-center justify-between mb-1">
                              <h4 className="font-bold text-gray-900 text-xs">{n.title}</h4>
                              <span className="text-[10px] font-mono text-gray-400">{n.date}</span>
                            </div>
                            <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap">{n.content}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

              ) : currentTab === '学会・コンテスト' ? (
                <div className="space-y-6">
                  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-bold text-gray-900">案内中の学会・コンテスト</h2>
                      <p className="text-xs font-medium text-gray-500">LTI本部から自校宛てに届いている学会発表・探究コンテストの案内一覧です。</p>
                    </div>
                    <span className="text-xs font-bold bg-orange-50 text-orange-700 px-3 py-1.5 rounded-xl">
                      {visibleContests.length} 件
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {visibleContests.length === 0 ? (
                      <div className="col-span-2 p-12 text-center bg-white rounded-2xl border border-gray-200 text-gray-400 text-xs font-bold">
                        現在案内中の学会・コンテストはありません。
                      </div>
                    ) : (
                      visibleContests.map(c => (
                        <div key={c.id} className={`bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-3 ${isContestExpired(c) ? 'opacity-60' : ''}`}>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold px-2.5 py-0.5 rounded bg-orange-50 text-orange-700">{c.category}</span>
                            <div className="flex items-center gap-2">
                              {isContestExpired(c) && (
                                <span className="text-[10px] font-bold bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">期限切れ</span>
                              )}
                              <span className="text-xs text-gray-400 font-mono">{c.date}</span>
                            </div>
                          </div>
                          <h3 className="font-bold text-base text-gray-900">{c.title}</h3>
                          <p className="text-xs text-gray-600 leading-relaxed">{c.description}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>

              ) : currentTab === 'みんなの論文' ? (
                <div className="space-y-6">
                  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-bold text-gray-900">みんなの論文ライブラリ</h2>
                      <p className="text-xs font-medium text-gray-500">LTI事務局の承認を得て公開された全国の高校生の優れた探究論文を閲覧・指導の参考にできます。</p>
                    </div>
                    <span className="text-xs font-bold bg-orange-50 text-orange-700 px-3 py-1.5 rounded-xl">
                      公開中 {publishedList.filter(p => (teacherPaperFieldFilter === 'すべて' || p.field === teacherPaperFieldFilter) && matchesPaperSearch(p, teacherPaperSearchQuery)).length} / {publishedList.length} 件
                    </span>
                  </div>

                  <div className="relative">
                    <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      value={teacherPaperSearchQuery}
                      onChange={(e) => setTeacherPaperSearchQuery(e.target.value)}
                      placeholder="タイトル・著者・学校名で検索..."
                      className="w-full max-w-md pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400/20 focus:border-orange-400"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {['すべて', ...PAPER_FIELD_OPTIONS].map((f) => {
                      const count = f === 'すべて' ? publishedList.length : publishedList.filter(p => p.field === f).length;
                      return (
                        <button
                          key={f}
                          onClick={() => setTeacherPaperFieldFilter(f)}
                          className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors flex items-center gap-1.5 ${
                            teacherPaperFieldFilter === f
                              ? 'bg-orange-500 border-orange-500 text-white'
                              : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          {f}
                          <span className={`text-[10px] ${teacherPaperFieldFilter === f ? 'text-orange-100' : 'text-gray-400'}`}>{count}</span>
                        </button>
                      );
                    })}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {publishedList.filter(p => (teacherPaperFieldFilter === 'すべて' || p.field === teacherPaperFieldFilter) && matchesPaperSearch(p, teacherPaperSearchQuery)).length === 0 ? (
                      <div className="col-span-2 p-12 text-center bg-white rounded-2xl border border-gray-200 text-gray-400 text-xs font-bold">
                        {publishedList.length === 0 ? '現在公開されている論文はありません。' : '条件に一致する論文が見つかりませんでした。'}
                      </div>
                    ) : (
                      publishedList
                        .filter(p => (teacherPaperFieldFilter === 'すべて' || p.field === teacherPaperFieldFilter) && matchesPaperSearch(p, teacherPaperSearchQuery))
                        .map((paper) => (
                        <div key={paper.id} className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm hover:border-orange-200 transition-all space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold px-2.5 py-0.5 rounded bg-orange-50 text-orange-700">
                              {paper.field}
                            </span>
                            <span className="text-xs text-gray-400 font-mono">公開日: {paper.publishedDate}</span>
                          </div>
                          <h3 className="font-bold text-base text-gray-900 leading-snug">{paper.title}</h3>
                          <div className="text-xs text-gray-600 space-y-0.5 font-medium">
                            <p>🏫 {paper.schoolName}</p>
                            <p>👤 著者: {paper.author} （指導: {paper.submittedByTeacherName} 先生）</p>
                          </div>
                          {paper.abstract && (
                            <p className="text-xs text-gray-500 bg-gray-50 p-3 rounded-xl line-clamp-2">{paper.abstract}</p>
                          )}
                          <div className="pt-2 flex justify-end">
                            <button
                              onClick={() => setPreviewPaper(paper)}
                              className="px-3.5 py-1.5 bg-orange-50 hover:bg-orange-100 text-orange-700 font-bold text-xs rounded-xl transition-colors flex items-center gap-1"
                            >
                              <Eye className="w-3.5 h-3.5" /> 全文・詳細を確認
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

              ) : currentTab === '教材' ? (
                <div className="space-y-6">
                  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-1">
                    <h2 className="text-lg font-bold text-gray-900">学校専用オーダーメイド教材</h2>
                    <p className="text-xs font-medium text-gray-500">LTI運営から配布された、本校向けにカスタマイズされたオンライン教材です。生徒にも同じ内容が表示されます。</p>
                  </div>

                  {schoolMaterials.length === 0 ? (
                    <div className="p-12 text-center bg-white rounded-2xl border border-gray-200 text-gray-400 text-xs font-bold">
                      現在、本校向けにアップロードされた教材はありません。
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {schoolMaterials.map((mat) => (
                        <div key={mat.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                          {mat.slides && mat.slides.length > 0 && (
                            <div className="w-full h-36 bg-gray-100">
                              <img src={mat.slides[0].imageUrl} alt="" className="w-full h-full object-cover" />
                            </div>
                          )}
                          <div className="p-6 space-y-3">
                            <h3 className="font-bold text-base text-gray-900 leading-snug">{mat.title}</h3>
                            <p className="text-xs text-gray-500">{mat.description}</p>
                            <p className="text-[11px] text-gray-400 font-mono flex items-center gap-1">
                              <BookOpen className="w-3.5 h-3.5 text-indigo-400" /> {mat.slides?.length || 0} 枚のスライド ・ {mat.uploadedAt}
                            </p>
                            <div className="pt-2 flex justify-end">
                              <button
                                onClick={() => setPreviewMaterialModalData(mat)}
                                className="px-3.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold text-xs rounded-xl transition-colors flex items-center gap-1"
                              >
                                <Eye className="w-3.5 h-3.5" /> 教材を見る
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              ) : currentTab === '探究論文の公開申請' ? (
                <div className="space-y-6 max-w-3xl">
                  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-1">
                    <h2 className="text-lg font-bold text-gray-900">探究論文の公開申請</h2>
                    <p className="text-sm font-medium text-gray-500">
                      生徒の優れた探究論文をアップロードし、LTIプラットフォームへの一般公開を申請できます。
                    </p>
                  </div>

                  {teacherApplyMessage && (
                    <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-xl flex items-center gap-2">
                      <Check className="w-4 h-4 text-emerald-600" /> {teacherApplyMessage}
                    </div>
                  )}

                  <form onSubmit={handleTeacherSubmitPaper} className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-700">論文タイトル</label>
                      <input
                        type="text"
                        value={teacherPaperTitle}
                        onChange={(e) => setTeacherPaperTitle(e.target.value)}
                        placeholder="例: AIを活用した地域コミュニティ活性化の提案"
                        className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400/20 focus:border-orange-400"
                        required
                      />
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-700">著者（生徒氏名）</label>
                        <input
                          type="text"
                          value={teacherPaperAuthor}
                          onChange={(e) => setTeacherPaperAuthor(e.target.value)}
                          placeholder="氏名"
                          className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400/20 focus:border-orange-400"
                          required
                        />
                      </div>

                      <div className="space-y-1">
                        <label className="text-xs font-bold text-gray-700">研究分野</label>
                        <select
                          value={teacherPaperField}
                          onChange={(e) => setTeacherPaperField(e.target.value)}
                          className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400/20 focus:border-orange-400"
                        >
                          {PAPER_FIELD_OPTIONS.map((f) => (
                            <option key={f} value={f}>{f}</option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-bold text-gray-700">論文の要旨（200字程度）</label>
                        <span className={`text-[10px] font-mono font-bold ${teacherPaperAbstract.length > 200 ? 'text-rose-600' : 'text-gray-400'}`}>
                          {teacherPaperAbstract.length} / 200字
                        </span>
                      </div>
                      <textarea
                        value={teacherPaperAbstract}
                        onChange={(e) => setTeacherPaperAbstract(e.target.value)}
                        placeholder="研究の目的・方法・結果を簡潔にまとめてください。（例: 過疎化が進む地域における...）"
                        rows={4}
                        className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400/20 focus:border-orange-400 resize-none"
                      ></textarea>
                      <p className="text-[10px] text-gray-400">この要旨は、LTI運営の審査画面や「みんなの論文」の一覧・詳細に表示されます。</p>
                    </div>

                    <div className="space-y-2 pt-2">
                      <label className="text-xs font-bold text-gray-700">論文ファイル（PDF・Word .docx）</label>
                      <div className="border-2 border-dashed border-gray-300 hover:border-orange-400 rounded-xl p-6 text-center bg-gray-50 transition-colors relative cursor-pointer">
                        <input
                          type="file"
                          accept=".pdf,.docx"
                          onChange={(e) => {
                            if (e.target.files && e.target.files[0]) {
                              setTeacherPaperFile(e.target.files[0]);
                            }
                          }}
                          className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                        />
                        <div className="space-y-1 pointer-events-none">
                          <Upload className="w-8 h-8 text-orange-500 mx-auto" />
                          <p className="text-xs font-bold text-gray-700">クリックしてPDF・Wordを選択</p>
                          <p className="text-[10px] text-gray-400">※最大ファイルサイズ: 10MB</p>
                        </div>
                      </div>
                      {teacherPaperFile && (
                        <div className="p-2.5 bg-orange-50 border border-orange-200 text-xs font-bold text-orange-800 rounded-xl flex items-center justify-between">
                          <span>添付ファイル: {teacherPaperFile.name}</span>
                          <button type="button" onClick={() => setTeacherPaperFile(null)} className="text-red-600 hover:underline">削除</button>
                        </div>
                      )}
                    </div>

                    <button
                      type="submit"
                      className="py-3 px-6 bg-orange-400 hover:bg-orange-500 text-white font-bold rounded-xl transition-colors text-sm shadow-sm flex items-center gap-2"
                    >
                      <FileUp className="w-4 h-4" /> LTIへ公開申請を送信する
                    </button>
                  </form>

                  <div className="space-y-3 pt-4">
                    <h3 className="text-sm font-bold text-gray-900">自校からの申請済み論文履歴</h3>
                    <div className="space-y-2">
                      {papers.filter(p => (p.submittedByTeacherId === loggedInTeacher.id && p.schoolId === schoolId) || p.schoolId === schoolId).map(paper => (
                        <div key={paper.id} className="p-4 bg-white rounded-2xl border border-gray-200 shadow-sm flex items-center justify-between text-xs">
                          <div>
                            <span className="font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded">{paper.field}</span>
                            <h4 className="font-bold text-sm text-gray-900 mt-1">{paper.title}{paper.withdrawalRequested&&<span className="ml-2 text-red-700">差し止め申請あり</span>}</h4>
                            <p className="text-gray-500 mt-0.5">著者: {paper.author} | 申請日: {paper.submittedDate}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            {paper.status!=='公開中'&&<><button className="underline" onClick={()=>{setEditingPaper(paper);setTeacherPaperTitle(paper.title);setTeacherPaperAuthor(paper.author);setTeacherPaperAbstract(paper.abstract||'');setTeacherPaperField(paper.field);setTeacherPaperFile(null);}}>修正</button><button className="text-red-700" onClick={()=>{if(confirm('この公開申請を取り消しますか？'))setPapers(papers.filter(p=>p.id!==paper.id));}}>申請取消</button></>}{paper.status==='公開中'&&<button disabled={paper.withdrawalRequested} className="text-red-700" onClick={()=>{if(confirm('運営へ公開差し止めを申請しますか？'))setPapers(papers.map(p=>p.id===paper.id?{...p,withdrawalRequested:true}:p));}}>{paper.withdrawalRequested?'差し止め申請済み':'差し止め申請'}</button>}
                            <button onClick={() => setPreviewPaper(paper)} className="px-2.5 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-lg text-xs">
                              中身を確認
                            </button>
                            <span className={`px-2.5 py-1 rounded-full font-bold text-xs ${
                              paper.status === '公開中' ? 'bg-emerald-100 text-emerald-800' :
                              paper.status === '承認待ち' ? 'bg-amber-100 text-amber-800' :
                              paper.status === '公開停止' ? 'bg-gray-100 text-gray-700' : 'bg-rose-100 text-rose-800'
                            }`}>
                              {paper.status}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

              ) : currentTab === '進捗管理' ? (
                <div className="space-y-6">
                  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-bold text-gray-900">発信課題の提出率・進捗管理</h2>
                      <p className="text-sm font-medium text-gray-500">配信した各課題の生徒の提出率、提出物（入力文章・添付PDF）の詳細を確認できます。</p>
                    </div>
                    <span className="text-xs font-bold bg-orange-50 text-orange-700 px-3 py-1.5 rounded-xl">
                      所属生徒 {schoolStudents.length} 名
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {schoolAssignments.map((item) => {
                      const totalStudents = schoolStudents.length;
                      const submittedCount = schoolStudents.filter(s => item.submissions?.[s.id]?.status === '提出済み').length;
                      const rate = totalStudents > 0 ? Math.round((submittedCount / totalStudents) * 100) : 0;
                      const isSelected = (progressSelectedAssignId ?? schoolAssignments[0]?.id) === item.id;

                      return (
                        <div
                          key={item.id}
                          onClick={() => setProgressSelectedAssignId(item.id)}
                          className={`p-5 rounded-2xl border cursor-pointer transition-all bg-white shadow-sm space-y-3 ${
                            isSelected ? 'ring-2 ring-orange-400 border-orange-400' : 'hover:border-orange-200'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-gray-400 font-mono flex items-center gap-1">
                              <Clock className="w-3.5 h-3.5" /> 期限: {item.deadline}
                            </span>
                            <span className="text-xs font-bold text-orange-700 bg-orange-50 px-2.5 py-0.5 rounded-full">
                              提出者: {submittedCount} / {totalStudents}名
                            </span>
                          </div>
                          <h3 className="font-bold text-gray-900 text-base">{item.title}</h3>
                          <div className="space-y-1">
                            <div className="flex justify-between items-center text-xs font-bold">
                              <span className="text-gray-500">提出率</span>
                              <span className="text-orange-600">{rate}%</span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                              <div
                                className="bg-orange-400 h-2.5 rounded-full transition-all duration-500"
                                style={{ width: `${rate}%` }}
                              ></div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {(() => {
                    const currentAssignId = progressSelectedAssignId ?? schoolAssignments[0]?.id;
                    const activeAssign = schoolAssignments.find(a => a.id === currentAssignId);
                    if (!activeAssign) return null;

                    const totalStudents = schoolStudents.length;
                    const submittedList = schoolStudents.filter(s => activeAssign.submissions?.[s.id]?.status === '提出済み');
                    const unsubmittedList = schoolStudents.filter(s => !activeAssign.submissions?.[s.id] || activeAssign.submissions[s.id].status !== '提出済み').sort((a,b)=>a.class.localeCompare(b.class,'ja',{numeric:true}) || ((a as any).attendance_number ?? Number.MAX_SAFE_INTEGER)-((b as any).attendance_number ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name,'ja'));
                    const rate = totalStudents > 0 ? Math.round((submittedList.length / totalStudents) * 100) : 0;

                    return (
                      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-6">
                        <div className="border-b border-gray-100 pb-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
                          <div>
                            <span className="text-xs font-bold text-orange-600">選択中の課題分析</span>
                            <h3 className="text-xl font-bold text-gray-900">{activeAssign.title}</h3>
                            <p className="text-xs font-medium text-gray-500 mt-1">{activeAssign.description}</p>
                          </div>
                          <div className="flex items-center gap-4 bg-gray-50 p-4 rounded-xl border border-gray-200">
                            <div className="text-center">
                              <p className="text-xs font-bold text-gray-400">提出率</p>
                              <p className="text-2xl font-extrabold text-orange-500">{rate}%</p>
                            </div>
                            <div className="w-px h-8 bg-gray-200"></div>
                            <div className="text-center">
                              <p className="text-xs font-bold text-gray-400">提出完了</p>
                              <p className="text-xl font-extrabold text-emerald-600">{submittedList.length} <span className="text-xs font-medium text-gray-500">名</span></p>
                            </div>
                            <div className="w-px h-8 bg-gray-200"></div>
                            <div className="text-center">
                              <p className="text-xs font-bold text-gray-400">未提出</p>
                              <p className="text-xl font-extrabold text-rose-600">{unsubmittedList.length} <span className="text-xs font-medium text-gray-500">名</span></p>
                            </div>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-3">
                            <h4 className="font-bold text-sm text-gray-900 flex items-center gap-2">
                              <CheckCircle2 className="w-4 h-4 text-emerald-600" /> 提出者一覧・個別回答閲覧 ({submittedList.length}名)
                            </h4>
                            <div className="space-y-3 max-h-[500px] overflow-y-auto pr-1">
                              {submittedList.length === 0 ? (
                                <p className="text-xs font-medium text-gray-400 italic p-4 bg-gray-50 rounded-xl text-center">まだ提出者がいません。</p>
                              ) : (
                                submittedList.map(student => {
                                  const sub = activeAssign.submissions[student.id];
                                  const fileName = sub.submittedFile ? (typeof sub.submittedFile === 'string' ? sub.submittedFile : sub.submittedFile.name) : null;
                                  return (
                                    <div key={student.id} className="p-4 bg-emerald-50/40 rounded-xl border border-emerald-100 text-xs space-y-2.5">
                                      <div className="flex items-center justify-between border-b border-emerald-100 pb-2">
                                        <span className="font-bold text-gray-900 text-sm">{student.name} <span className="text-xs font-normal text-gray-500">({student.class}・出席番号 {(student as any).attendance_number ?? "未設定"})</span></span>
                                        <span className="text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded">{sub.submittedAt}{sub.late && <strong className="ml-2 text-rose-700">遅れ</strong>}</span>
                                      </div>
                                      
                                      <div className="space-y-1">
                                        <p className="font-bold text-gray-700 text-[11px]">【生徒入力コメント・報告文】</p>
                                        <p className="text-gray-800 bg-white p-3 rounded-lg border border-emerald-200/60 whitespace-pre-wrap text-xs leading-relaxed">
                                          {sub.submittedText || '（入力されたテキストはありません）'}
                                        </p>
                                      </div>

                                      <form className="space-y-2" onSubmit={e=>{e.preventDefault();const form=e.currentTarget;const note=String(new FormData(form).get('feedback')||'').trim();if(!note)return;setStudentFeedbackMessages([{id:Date.now(),assignmentId:String(activeAssign.id),schoolId,studentId:student.id,teacherName:loggedInTeacher.name,paperTitle:activeAssign.title,fileName:fileName||'',result:{corrections:[],advice:[],nextExperiments:[]},note,sentAt:new Date().toISOString(),read:false},...studentFeedbackMessages]);form.reset();}}><textarea name="feedback" required maxLength={10000} aria-label="課題へのフィードバック" placeholder="この提出物へのフィードバック" className="w-full border rounded-lg p-3"/><button className="bg-orange-100 p-2 rounded-lg">生徒にフィードバックを送る</button></form>
                                      {fileName ? (
                                        <div className="flex items-center justify-between bg-white p-2.5 rounded-lg border border-emerald-200/60">
                                          <span className="text-emerald-800 font-bold flex items-center gap-1.5 truncate pr-2">
                                            <FileText className="w-4 h-4 text-red-500 shrink-0" /> {fileName}
                                          </span>
                                          <button
                                            onClick={() => setPreviewPdfModalData({ studentName: student.name, fileName, text: sub.submittedText, storagePath: sub.storagePath })}
                                            className="px-3 py-1 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-lg transition-colors flex items-center gap-1 shrink-0"
                                          >
                                            <Eye className="w-3.5 h-3.5" /> 添付を開く
                                          </button>
                                        </div>
                                      ) : (
                                        <p className="text-gray-400 italic text-[11px]">※添付ファイルなし</p>
                                      )}
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </div>

                          <div className="space-y-3">
                            <h4 className="font-bold text-sm text-gray-900 flex items-center gap-2">
                              <XCircle className="w-4 h-4 text-rose-600" /> 未提出者一覧 ({unsubmittedList.length}名)
                            </h4>
                            <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
                              {unsubmittedList.map(student => (
                                <div key={student.id} className="p-3 bg-gray-50 rounded-xl border border-gray-200 text-xs flex items-center justify-between">
                                  <div>
                                    <span className="font-bold text-gray-900">{student.name}</span>
                                    <span className="ml-2 text-gray-400 font-medium">({student.class} / {student.id})</span>
                                  </div>
                                  <span className="text-[10px] font-bold bg-rose-100 text-rose-700 px-2 py-0.5 rounded">未提出</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ) : currentTab === '課題配信' ? (
                <div className="space-y-8 max-w-3xl">
                  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-1">
                    <h2 className="text-lg font-bold text-gray-900">
                      {editingAssignmentId !== null ? '課題の編集・再配信' : '新規課題の作成・配信'}
                    </h2>
                    <p className="text-sm font-medium text-gray-500">
                      {editingAssignmentId !== null ? '内容を修正して「再配信する」を押すと生徒側に反映されます。' : 'ここで作成した課題は、全生徒のホーム画面および課題・提出物ページに即座に表示されます。'}
                    </p>
                  </div>

                  {assignMessage && (
                    <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-xl flex items-center gap-2">
                      <Check className="w-4 h-4" /> {assignMessage}
                    </div>
                  )}

                  <form onSubmit={handleCreateOrUpdateAssignment} className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-700">課題タイトル</label>
                      <input
                        type="text"
                        value={newAssignTitle}
                        onChange={(e) => setNewAssignTitle(e.target.value)}
                        placeholder="例: 中間発表スライドの提出"
                        className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400/20 focus:border-orange-400"
                        required
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-700">提出期限</label>
                      <input
                        type="date"
                        value={newAssignDeadline}
                        onChange={(e) => setNewAssignDeadline(e.target.value)}
                        placeholder="例: 2026/08/10"
                        className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400/20 focus:border-orange-400 font-mono"
                        required
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-700">詳細・指示事項</label>
                      <textarea
                        value={newAssignDesc}
                        onChange={(e) => setNewAssignDesc(e.target.value)}
                        placeholder="課題の詳細や留意点を入力してください"
                        rows={4}
                        className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400/20 focus:border-orange-400 resize-none"
                      ></textarea>
                    </div>

                    <div className="flex items-center gap-3">
                      <button
                        type="submit"
                        className="py-2.5 px-5 bg-orange-400 hover:bg-orange-500 text-white font-semibold rounded-xl transition-colors text-sm shadow-sm flex items-center gap-2"
                      >
                        <FileText className="w-4 h-4" /> {editingAssignmentId !== null ? '課題を再配信する' : '生徒に課題を配信する'}
                      </button>
                      {editingAssignmentId !== null && (
                        <button
                          type="button"
                          onClick={() => {
                            setEditingAssignmentId(null);
                            setNewAssignTitle('');
                            setNewAssignDeadline('');
                            setNewAssignDesc('');
                          }}
                          className="py-2.5 px-4 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-xl text-xs"
                        >
                          編集キャンセル
                        </button>
                      )}
                    </div>
                  </form>

                  <div className="space-y-3">
                    <h3 className="text-sm font-bold text-gray-900">配信中の課題一覧</h3>
                    {schoolAssignments.map(assign => (
                      <div key={assign.id} className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm flex items-start justify-between gap-4">
                        <div className="space-y-1">
                          <span className="text-xs font-mono font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded">期限: {assign.deadline}</span>
                          <h4 className="font-bold text-gray-900 text-base">{assign.title}</h4>
                          <p className="text-xs text-gray-500">{assign.description}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => handleEditClick(assign)} className="p-2 text-gray-500 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition-colors">
                            <Edit3 className="w-4 h-4" />
                          </button>
                          <button onClick={() => handleDeleteAssignment(assign.id)} className="p-2 text-gray-500 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

              ) : currentTab === 'AI添削' ? (
                <div className="space-y-6">
                  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-1">
                    <h2 className="text-lg font-bold text-gray-900">AI添削</h2>
                    <p className="text-sm font-medium text-gray-500">
                      生徒の探究論文（Word）をドロップすると、AIが修正点・アドバイス・追加実験の方向性を指摘します。内容を確認・編集してから、生徒へメッセージとして送信できます。
                    </p>
                  </div>

                  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-3">
                    <div className="border-2 border-dashed border-gray-300 hover:border-orange-400 rounded-xl p-6 text-center bg-gray-50 transition-colors relative cursor-pointer">
                      <input
                        type="file"
                        accept=".docx"
                        multiple
                        onChange={(e) => { handleAiReviewFilesSelected(e.target.files); e.target.value = ''; }}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      />
                      <div className="space-y-1 pointer-events-none">
                        <Bot className="w-8 h-8 text-orange-500 mx-auto" />
                        <p className="text-xs font-bold text-gray-700">クリックまたはドラッグ＆ドロップでWordファイル（.docx）を選択</p>
                        <p className="text-[10px] text-gray-400">※ .docx形式のみ対応。複数ファイルをまとめて選択できます。</p>
                      </div>
                    </div>
                  </div>

                  {aiReviewItems.length === 0 ? (
                    <div className="p-12 text-center bg-white rounded-2xl border border-gray-200 text-gray-400 text-xs font-bold">
                      まだ添削中の論文はありません。上のエリアにWordファイルをドロップしてください。
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {aiReviewItems.map((item) => (
                        <div key={item.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 space-y-4">
                          <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                              <p className="text-xs font-bold text-gray-500 flex items-center gap-1.5">
                                <FileText className="w-3.5 h-3.5" /> {item.fileName}
                              </p>
                              <input
                                type="text"
                                value={item.paperTitle}
                                onChange={(e) => updateAiReviewItem(item.id, { paperTitle: e.target.value })}
                                disabled={item.sent}
                                className="text-sm font-bold text-gray-900 bg-transparent border-b border-transparent hover:border-gray-200 focus:border-orange-400 focus:outline-none disabled:text-gray-400 px-0 py-0.5"
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              {item.status === 'processing' && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 flex items-center gap-1">
                                  <span className="w-2.5 h-2.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" /> AI添削中...
                                </span>
                              )}
                              {item.status === 'done' && !item.sent && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">添削完了</span>
                              )}
                              {item.status === 'error' && !item.sent && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">要手動入力</span>
                              )}
                              {item.sent && (
                                <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 flex items-center gap-1">
                                  <Check className="w-3 h-3" /> 送信済み
                                </span>
                              )}
                              {!item.sent && (
                                <button type="button" onClick={() => removeAiReviewItem(item.id)} className="text-gray-400 hover:text-red-600">
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          </div>

                          {item.status === 'error' && (
                            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-xl p-3">{item.error}</p>
                          )}

                          {item.status !== 'processing' && (
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-gray-500">修正点（1行1項目）</label>
                                <textarea
                                  value={item.result.corrections.join('\n')}
                                  onChange={(e) => updateAiReviewResultField(item.id, 'corrections', e.target.value)}
                                  disabled={item.sent}
                                  rows={5}
                                  placeholder="例: 3章の実験条件（温度・pH）の記載が不足している"
                                  className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-xs font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400/20 focus:border-orange-400 disabled:bg-gray-100 disabled:text-gray-500 resize-none"
                                ></textarea>
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-gray-500">アドバイス（1行1項目）</label>
                                <textarea
                                  value={item.result.advice.join('\n')}
                                  onChange={(e) => updateAiReviewResultField(item.id, 'advice', e.target.value)}
                                  disabled={item.sent}
                                  rows={5}
                                  placeholder="例: 先行研究との比較を考察に加えるとより説得力が増す"
                                  className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-xs font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400/20 focus:border-orange-400 disabled:bg-gray-100 disabled:text-gray-500 resize-none"
                                ></textarea>
                              </div>
                              <div className="space-y-1">
                                <label className="text-[10px] font-bold text-gray-500">追加実験の方向性（1行1項目）</label>
                                <textarea
                                  value={item.result.nextExperiments.join('\n')}
                                  onChange={(e) => updateAiReviewResultField(item.id, 'nextExperiments', e.target.value)}
                                  disabled={item.sent}
                                  rows={5}
                                  placeholder="例: 培養温度を5段階に変えて分解速度の違いを比較する"
                                  className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-xs font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400/20 focus:border-orange-400 disabled:bg-gray-100 disabled:text-gray-500 resize-none"
                                ></textarea>
                              </div>
                            </div>
                          )}

                          {item.status !== 'processing' && !item.sent && (
                            <div className="pt-3 border-t border-gray-100 space-y-3">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div className="space-y-1">
                                  <label className="text-[10px] font-bold text-gray-500">送信先の生徒</label>
                                  <select
                                    value={item.studentId}
                                    onChange={(e) => updateAiReviewItem(item.id, { studentId: e.target.value })}
                                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-xs font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400/20 focus:border-orange-400"
                                  >
                                    <option value="">選択してください</option>
                                    {schoolStudents.map((s) => (
                                      <option key={s.id} value={s.id}>{s.name}（{s.class}）</option>
                                    ))}
                                  </select>
                                </div>
                                <div className="space-y-1">
                                  <label className="text-[10px] font-bold text-gray-500">一言コメント（任意）</label>
                                  <input
                                    type="text"
                                    value={item.note}
                                    onChange={(e) => updateAiReviewItem(item.id, { note: e.target.value })}
                                    placeholder="例: 特に追加実験の部分、一緒に相談しましょう"
                                    className="w-full px-3 py-2 bg-gray-50 border border-gray-300 rounded-lg text-xs font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400/20 focus:border-orange-400"
                                  />
                                </div>
                              </div>
                              <div className="flex justify-end">
                                <button
                                  type="button"
                                  onClick={() => handleSendAiReviewToStudent(item)}
                                  disabled={!item.studentId}
                                  className="py-2.5 px-5 bg-orange-400 hover:bg-orange-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors text-xs shadow-sm flex items-center gap-2"
                                >
                                  <Send className="w-4 h-4" /> この内容を生徒に送信する
                                </button>
                              </div>
                            </div>
                          )}

                          {item.sent && (
                            <p className="text-[11px] text-blue-700 bg-blue-50 border border-blue-100 rounded-xl p-3">
                              {schoolStudents.find(s => s.id === item.studentId)?.name || '選択した生徒'} さんに送信しました。
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              ) : currentTab === '生徒管理' ? (
                <div className="space-y-6">
                  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-bold text-gray-900">生徒アカウント・パスワード管理</h2>
                      <p className="text-xs font-medium text-gray-500">本校に所属する全生徒（280名）のアカウント一覧です。パスワード忘れ等の対応を行えます。</p>
                    </div>
                    <span className="text-xs font-bold bg-orange-50 text-orange-700 px-3 py-1.5 rounded-xl">
                      所属生徒 {schoolStudents.length} 名
                    </span>
                  </div>

                  {teacherAccountMessage && (
                    <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-xl flex items-center gap-2">
                      <Check className="w-4 h-4" /> {teacherAccountMessage}
                    </div>
                  )}

                  <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="max-h-[600px] overflow-y-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead className="bg-gray-50 border-b border-gray-200 font-bold text-gray-600 sticky top-0">
                          <tr>
                            <th className="py-3 px-6">生徒ID (ログイン用)</th>
                            <th className="py-3 px-6">氏名</th>
                            <th className="py-3 px-6">クラス</th>
                            <th className="py-3 px-6">パスワード設定状態</th>
                            <th className="py-3 px-6 text-right">操作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {schoolStudents.map(student => (
                            <tr key={student.id} className="hover:bg-gray-50">
                              <td className="py-3 px-6 font-mono font-bold text-gray-800">{student.id}</td>
                              <td className="py-3 px-6 font-bold text-gray-900">{student.name}</td>
                              <td className="py-3 px-6 text-gray-600">{student.class}</td>
                              <td className="py-3 px-6">
                                {student.pass === '' ? (
                                  <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-bold text-[10px]">初期値 ()</span>
                                ) : (
                                  <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-bold text-[10px]">変更済み</span>
                                )}
                              </td>
                              <td className="py-3 px-6 text-right">
                                <button
                                  onClick={() => handleResetStudentPassword(student.id)}
                                  className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-lg text-xs"
                                >
                                  PWリセット
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 text-center font-medium">全{schoolStudents.length}名を表示中</p>
                </div>

              ) : currentTab === '教員管理' ? (
                <div className="space-y-6">
                  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-bold text-gray-900">教員アカウント管理</h2>
                      <p className="text-xs font-medium text-gray-500">本校に登録されている教員（20名）のアカウント一覧です。</p>
                    </div>
                    <span className="text-xs font-bold bg-orange-50 text-orange-700 px-3 py-1.5 rounded-xl">
                      教員数 {schoolTeachers.length} 名
                    </span>
                  </div>

                  <div className="bg-white rounded-2xl shadow-sm border border-gray-200 overflow-hidden">
                    <div className="max-h-[600px] overflow-y-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead className="bg-gray-50 border-b border-gray-200 font-bold text-gray-600 sticky top-0">
                          <tr>
                            <th className="py-3 px-6">教員ID</th>
                            <th className="py-3 px-6">氏名</th>
                            <th className="py-3 px-6">担当・教科</th>
                            <th className="py-3 px-6 text-right">操作</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {schoolTeachers.map(teacher => (
                            <tr key={teacher.id} className="hover:bg-gray-50">
                              <td className="py-3 px-6 font-mono font-bold text-gray-800">{teacher.id}</td>
                              <td className="py-3 px-6 font-bold text-gray-900">{teacher.name} 先生</td>
                              <td className="py-3 px-6 text-gray-600">{teacher.dept}</td>
                              <td className="py-3 px-6 text-right">
                                <button
                                  onClick={() => handleResetTeacherPassword(teacher.id)}
                                  className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 font-bold rounded-lg text-xs"
                                >
                                  PWリセット
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400 text-center font-medium">全{schoolTeachers.length}名を表示中</p>
                </div>

              ) : currentTab === 'アカウント設定' ? (
                <div className="space-y-6 max-w-2xl">
                  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-1">
                    <h2 className="text-lg font-bold text-gray-900">教員アカウント設定</h2>
                    <p className="text-xs font-medium text-gray-500">ご自身の表示名やログイン用パスワードを変更できます。</p>
                  </div>

                  {teacherProfileMessage && (
                    <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-xl flex items-center gap-2">
                      <Check className="w-4 h-4" /> {teacherProfileMessage}
                    </div>
                  )}

                  <form onSubmit={handleTeacherProfileUpdate} className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-700">教員ID (ログイン用 / 変更不可)</label>
                      <input
                        type="text"
                        value={loggedInTeacher.id}
                        disabled
                        className="w-full px-4 py-2.5 bg-gray-100 border border-gray-300 rounded-xl text-xs font-medium text-gray-500 cursor-not-allowed font-mono"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-700">氏名（表示名）</label>
                      <input
                        type="text"
                        value={editTeacherName}
                        onChange={(e) => setEditTeacherName(e.target.value)}
                        className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-xs font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400/20 focus:border-orange-400"
                        required
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-700">新しいパスワード (変更時のみ入力)</label>
                      <input
                        type="password"
                        value={teacherNewPass}
                        onChange={(e) => setTeacherNewPass(e.target.value)}
                        placeholder="変更しない場合は空欄のまま"
                        className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-xs font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-orange-400/20 focus:border-orange-400"
                      />
                    </div>

                    <button
                      type="submit"
                      className="py-2.5 px-5 bg-orange-400 hover:bg-orange-500 text-white font-bold rounded-xl text-xs shadow-sm"
                    >
                      設定を変更する
                    </button>
                  </form>
                </div>

              ) : (
                <div className="bg-white p-12 rounded-2xl border border-gray-200 shadow-sm text-center space-y-3">
                  <h2 className="text-lg font-bold text-gray-900">{currentTab}</h2>
                  <p className="text-xs text-gray-500">選択されたメニューのコンテンツ画面です。</p>
                </div>
              )}

            </div>
          </main>
        </div>
      </div>
    );
  }

  // ----------------------------------------
  // 生徒用画面
  // ----------------------------------------
  if (step === 'student') {
    const loggedInStudent = studentsList.find(s => s.id === currentStudentId && s.schoolId === schoolId) || {
      id: currentStudentId,
      name: '生徒',
      class: '2年1組',
      pass: '',
      theme: '未設定のテーマ',
      schoolId: schoolId
    };

    const schoolAssignments = assignments.filter(a => a.schoolId === schoolId);
    const schoolMaterials = teachingMaterials.filter(m => m.schoolId === schoolId);
    const publishedList = papers.filter(p => p.status === '公開中');
    const studentSearchResults = publishedList.filter(p => matchesPaperSearch(p, studentPaperSearchQuery));
    const studentFilteredPapers = studentSearchResults.filter(p =>
      studentPaperFieldFilter === 'すべて' || p.field === studentPaperFieldFilter
    );
    const studentPaperFields = Array.from(new Set<string>([
      ...PAPER_FIELD_OPTIONS, ...publishedList.map(p => p.field).filter(Boolean)
    ]));


    // 【要件②用】生徒側で閲覧可能なコンテスト（一斉公開 または 自校が指定された公開）
    const visibleContests = contests.filter(c => c.targetType === 'all' || (c.targetSchoolIds && c.targetSchoolIds.includes(schoolId)));

    // 先生から送られたAI添削フィードバック（自分宛のもののみ、新しい順）
    const myFeedbackMessages = studentFeedbackMessages
      .filter(m => m.schoolId === schoolId && m.studentId === currentStudentId)
      .sort((a, b) => b.id - a.id);

    // 既読メッセージのうち、手動でもう一度開いて表示中のもの（未読は常に展開表示なのでここには含めない）
    const markFeedbackAsRead = (id: number) => {
      setStudentFeedbackMessages(studentFeedbackMessages.map(m => m.id === id ? { ...m, read: true } : m));
    };
    const toggleFeedbackExpanded = (id: number) => {
      setExpandedFeedbackIds(prev => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
      });
    };
    // 未読カードをクリックしたら「既読」にしつつ、その場では畳まず表示したままにする
    const handleFeedbackCardClick = (m: StudentFeedbackMessage) => {
      if (!m.read) {
        markFeedbackAsRead(m.id);
        setExpandedFeedbackIds(prev => new Set(prev).add(m.id));
      } else {
        toggleFeedbackExpanded(m.id);
      }
    };

    const studentMenuBase = [
      { name: 'ホーム', icon: Home },
      { name: '課題・提出物', icon: FileText },
      { name: '教材', icon: FileUp },
      { name: '学会・コンテスト', icon: Trophy },
      { name: 'みんなの論文', icon: BookOpen },
      { name: '学術論文の検索', icon: Search },
      { name: '先生からのフィードバック', icon: Bot },
      { name: 'アカウント設定', icon: UserCog },
    ];
    const studentMenuNames = reconcileMenuOrder(studentMenuOrder, studentMenuBase.map(m => m.name));
    const studentMenu = studentMenuNames
      .map(name => studentMenuBase.find(m => m.name === name))
      .filter((m): m is typeof studentMenuBase[number] => !!m);

    return (
      <div className="min-h-screen bg-gray-50 flex font-sans text-gray-900">
        <PaperPreviewModal previewPaper={previewPaper} setPreviewPaper={setPreviewPaper} step={step} schoolId={schoolId} paperReplyDraft={paperReplyDraft} setPaperReplyDraft={setPaperReplyDraft} handleSendPaperMessage={handleSendPaperMessage} />
        <PdfPreviewModal previewPdfModalData={previewPdfModalData} setPreviewPdfModalData={setPreviewPdfModalData} />
        <MaterialPreviewModal previewMaterialModalData={previewMaterialModalData} setPreviewMaterialModalData={setPreviewMaterialModalData} />
        <ResubmitConfirmModal
          showResubmitConfirmModal={showResubmitConfirmModal}
          setShowResubmitConfirmModal={setShowResubmitConfirmModal}
          selectedAssignmentId={selectedAssignmentId}
          assignments={assignments}
          setAssignments={setAssignments}
          currentStudentId={currentStudentId}
          setStudentSubmissionText={setStudentSubmissionText}
          setStudentSubmissionFile={setStudentSubmissionFile}
          setStudentSubmitSuccessMsg={setStudentSubmitSuccessMsg}
        />

        <aside className="w-64 bg-white shadow-sm flex flex-col border-r border-gray-200">
          <div className="h-16 flex items-center px-6 border-b border-gray-200 justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-emerald-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">L</div>
              <span className="text-xl font-extrabold text-gray-900 tracking-tight">LTI Explore</span>
            </div>
          </div>

          <div className="px-6 py-3 bg-gray-50 border-b border-gray-200 flex items-center gap-2">
            <Building2 className="w-3.5 h-3.5 text-gray-400" />
            <span className="text-xs font-mono font-bold text-gray-600 truncate">{schoolId}</span>
          </div>

          <div className="p-4 flex-1 overflow-y-auto">
            <div className="flex items-center justify-between mb-4 px-2">
              <span className="bg-emerald-100 text-emerald-800 text-xs font-bold px-2.5 py-1 rounded-full">
                生徒モード
              </span>
              <button onClick={() => void signOut()} className="text-xs font-bold text-gray-400 hover:text-gray-700 flex items-center gap-1">
                <LogOut className="w-3.5 h-3.5" /> ログアウト
              </button>
            </div>

            <nav className="space-y-1">
              {studentMenu.map((item) => {
                const Icon = item.icon;
                const isActive = currentTab === item.name;
                const isDragging = draggedTabName === item.name;
                return (
                  <button
                    key={item.name}
                    draggable
                    onDragStart={() => handleTabDragStart(item.name)}
                    onDragOver={handleTabDragOver}
                    onDrop={() => handleTabDrop(item.name, studentMenuOrder, setStudentMenuOrder, studentMenuBase.map(m => m.name))}
                    onDragEnd={() => setDraggedTabName(null)}
                    onClick={() => {
                      setCurrentTab(item.name);
                      setStudentSubmitSuccessMsg('');
                    }}
                    className={`w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-semibold transition-colors cursor-grab active:cursor-grabbing ${
                      isActive ? 'bg-emerald-50 text-emerald-800 font-bold' : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                    } ${isDragging ? 'opacity-30' : ''}`}
                  >
                    <GripVertical className="h-3.5 w-3.5 text-gray-300 shrink-0" />
                    {Icon && <Icon className={`h-5 w-5 shrink-0 ${isActive ? 'text-emerald-600' : 'text-gray-400'}`} />}
                    <span className="truncate">{item.name}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        </aside>

        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-8 shadow-sm sticky top-0 z-10">
            <div className="flex items-center gap-4 w-96">
              <div className="relative w-full">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                <input
                  type="text"
                  placeholder="検索..."
                  className="w-full pl-9 pr-4 py-1.5 bg-gray-50 border border-gray-300 rounded-lg text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                />
              </div>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-3 border-l pl-4 border-gray-200">
                <div className="w-9 h-9 bg-emerald-100 rounded-full flex items-center justify-center font-bold text-emerald-700 text-sm">
                  {loggedInStudent.name.charAt(0)}
                </div>
                <div>
                  <p className="text-sm font-bold text-gray-900">{loggedInStudent.name}</p>
                  <p className="text-xs font-medium text-gray-400">{loggedInStudent.class} | ID: {loggedInStudent.id}</p>
                </div>
              </div>
            </div>
          </header>

          <main className="flex-1 p-8 overflow-y-auto">
            <div className="max-w-7xl mx-auto space-y-6">

              {currentTab === 'ホーム' ? (
                <div className="space-y-6">
                  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-2">
                    <h1 className="text-xl font-extrabold text-gray-900">マイポータル</h1>
                    <p className="text-xs font-medium text-gray-500">学校の先生からの課題確認や成果の提出を行えます。</p>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-5 bg-white rounded-2xl border border-gray-200 shadow-sm space-y-1">
                      <p className="text-xs font-bold text-gray-400">現在配信中の課題</p>
                      <p className="text-2xl font-extrabold text-gray-900">{schoolAssignments.length} <span className="text-xs font-medium text-gray-500">件</span></p>
                    </div>
                    <div className="p-5 bg-white rounded-2xl border border-gray-200 shadow-sm space-y-1">
                      <p className="text-xs font-bold text-gray-400">利用可能な教材</p>
                      <p className="text-2xl font-extrabold text-emerald-600">{schoolMaterials.length} <span className="text-xs font-medium text-gray-500">件</span></p>
                    </div>
                  </div>

                  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4">
                    <h3 className="font-bold text-sm text-gray-900 flex items-center gap-1.5">📢 LTI運営からのお知らせ</h3>
                    {notices.length === 0 ? (
                      <p className="text-xs text-gray-400 italic">現在お知らせはありません。</p>
                    ) : (
                      <div className="space-y-3">
                        {notices.map(n => (
                          <div key={n.id} className="p-4 bg-gray-50 rounded-xl border border-gray-100">
                            <div className="flex items-center justify-between mb-1">
                              <h4 className="font-bold text-gray-900 text-xs">{n.title}</h4>
                              <span className="text-[10px] font-mono text-gray-400">{n.date}</span>
                            </div>
                            <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-wrap">{n.content}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

              ) : currentTab === '課題・提出物' ? (
                <div className="space-y-6">
                  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-bold text-gray-900">課題・提出物一覧</h2>
                      <p className="text-xs font-medium text-gray-500">先生から出された課題を選択して、文章やPDFファイルを提出してください。</p>
                    </div>
                  </div>

                  {studentSubmitSuccessMsg && (
                    <div className="p-4 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-xl flex items-center gap-2">
                      <Check className="w-4 h-4 text-emerald-600" /> {studentSubmitSuccessMsg}
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {schoolAssignments.map(assign => {
                      const submission = assign.submissions?.[currentStudentId];
                      const isSubmitted = submission && submission.status === '提出済み';

                      return (
                        <div key={assign.id} className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-mono font-bold text-emerald-700 bg-emerald-50 px-2.5 py-0.5 rounded">
                              期限: {assign.deadline}
                            </span>
                            <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full ${
                              isSubmitted ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'
                            }`}>
                              {isSubmitted ? (submission.late?'提出済み・遅れ':'提出済み') : '未提出'}
                            </span>
                          </div>

                          <div>
                            <h3 className="font-bold text-base text-gray-900">{assign.title}</h3>
                            <p className="text-xs text-gray-500 mt-1 leading-relaxed">{assign.description}</p>
                          </div>

                          {isSubmitted ? (
                            <div className="p-3 bg-emerald-50/60 border border-emerald-200 rounded-xl space-y-2 text-xs">
                              <p className="font-bold text-emerald-900">【提出済みの内容】</p>
                              <p className="text-gray-700 whitespace-pre-wrap">{submission.submittedText || '（テキストなし）'}</p>
                              {submission.submittedFile && (
                                <p className="text-emerald-800 font-bold flex items-center gap-1 pt-1">
                                  <FileText className="w-3.5 h-3.5 text-red-500" />
                                  添付: {typeof submission.submittedFile === 'string' ? submission.submittedFile : submission.submittedFile.name}
                                </p>
                              )}
                              <PdfView path={submission.storagePath} />
                              {studentFeedbackMessages.filter(m=>m.assignmentId===String(assign.id)&&m.studentId===currentStudentId).map(m=><div key={m.id} className="p-3 bg-white rounded-lg"><strong>{m.teacherName}先生から</strong><p className="whitespace-pre-wrap">{m.note}</p></div>)}
                              <p className="text-[10px] text-gray-400 font-mono pt-1">提出日時: {submission.submittedAt}</p>
                              
                              <button
                                onClick={() => {
                                  setSelectedAssignmentId(assign.id);
                                  setShowResubmitConfirmModal(true);
                                }}
                                className="w-full mt-2 py-2 bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 font-bold text-xs rounded-lg transition-colors"
                              >
                                課題を再提出する
                              </button>
                            </div>
                          ) : (
                            <form
                              onSubmit={async (e) => {
                                e.preventDefault();
                                if (!studentSubmissionText.trim() && !studentSubmissionFile) {
                                  alert('テキストを入力するかファイルを選択してください。');
                                  return;
                                }

                                let storagePath: string | undefined;
                                try { if (studentSubmissionFile) storagePath = await uploadPdf(studentSubmissionFile); } catch (error) { alert((error as Error).message); return; }
                                const nowStr = new Date().toLocaleString('ja-JP', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });

                                setAssignments(assignments.map(a => {
                                  if (a.id === assign.id) {
                                    return {
                                      ...a,
                                      submissions: {
                                        ...a.submissions,
                                        [currentStudentId]: {
                                          storagePath,
                                          submittedText: studentSubmissionText,
                                          submittedFile: studentSubmissionFile ? { name: studentSubmissionFile.name } : null,
                                          status: '提出済み',
                                          submittedAt: nowStr,
                                          late: Date.now()>new Date(assign.deadline.replace(/\//g,'-')+'T23:59:59+09:00').getTime()
                                        }
                                      }
                                    };
                                  }
                                  return a;
                                }));

                                setStudentSubmissionText('');
                                setStudentSubmissionFile(null);
                                setStudentSubmitSuccessMsg('課題を正常に提出しました！');
                                setTimeout(() => setStudentSubmitSuccessMsg(''), 4000);
                              }}
                              className="space-y-3 pt-2 border-t border-gray-100"
                            >
                              <textarea
                                value={studentSubmissionText}
                                onChange={(e) => setStudentSubmissionText(e.target.value)}
                                placeholder="提出用コメント・レポート文章を入力..."
                                rows={3}
                                className="w-full p-3 bg-gray-50 border border-gray-300 rounded-xl text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600 resize-none"
                              ></textarea>

                              <div className="space-y-1">
                                <input
                                  type="file"
                                  accept=".pdf,.docx"
                                  onChange={(e) => {
                                    if (e.target.files && e.target.files[0]) {
                                      setStudentSubmissionFile(e.target.files[0]);
                                    }
                                  }}
                                  className="block w-full text-xs text-gray-500 file:mr-3 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-bold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100"
                                />
                              </div>

                              <button
                                type="submit"
                                className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl transition-colors shadow-sm"
                              >
                                課題を提出する
                              </button>
                            </form>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

              ) : currentTab === '教材' ? (
                <div className="space-y-6">
                  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-1">
                    <h2 className="text-lg font-bold text-gray-900">オンライン教材</h2>
                    <p className="text-xs font-medium text-gray-500">学校から配布された専用の探究ガイド等のオンライン教材を閲覧できます。</p>
                  </div>

                  {schoolMaterials.length === 0 ? (
                    <div className="p-12 text-center bg-white rounded-2xl border border-gray-200 text-gray-400 text-xs font-bold">
                      現在配られている教材はありません。
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {schoolMaterials.map((mat) => (
                        <div key={mat.id} className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                          {mat.slides && mat.slides.length > 0 && (
                            <div className="w-full h-36 bg-gray-100">
                              <img src={mat.slides[0].imageUrl} alt="" className="w-full h-full object-cover" />
                            </div>
                          )}
                          <div className="p-6 space-y-3">
                            <h3 className="font-bold text-base text-gray-900 leading-snug">{mat.title}</h3>
                            <p className="text-xs text-gray-500">{mat.description}</p>
                            <p className="text-[11px] text-gray-400 font-mono flex items-center gap-1">
                              <BookOpen className="w-3.5 h-3.5 text-emerald-500" /> {mat.slides?.length || 0} 枚のスライド
                            </p>
                            <div className="pt-2 flex justify-end">
                              <button
                                onClick={() => setPreviewMaterialModalData(mat)}
                                className="px-3.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-xs rounded-xl transition-colors flex items-center gap-1"
                              >
                                <Eye className="w-3.5 h-3.5" /> 教材を見る
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

              ) : currentTab === '学会・コンテスト' ? (
                /* 【要件②用】生徒側：学会・コンテスト一覧（一斉公開 + 自校指定公開のみ表示） */
                <div className="space-y-6">
                  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-bold text-gray-900">学会・探究コンテスト一覧</h2>
                      <p className="text-xs font-medium text-gray-500">全国および本校の生徒向けに届いている探究コンテストや学会発表の案内です。</p>
                    </div>
                    <span className="text-xs font-bold bg-emerald-50 text-emerald-700 px-3 py-1.5 rounded-xl">
                      全 {visibleContests.length} 件
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {visibleContests.length === 0 ? (
                      <div className="col-span-2 p-12 text-center bg-white rounded-2xl border border-gray-200 text-gray-400 text-xs font-bold">
                        現在案内中の学会・コンテストはありません。
                      </div>
                    ) : (
                      visibleContests.map(c => (
                        <div key={c.id} className={`bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-3 ${isContestExpired(c) ? 'opacity-60' : ''}`}>
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-bold px-2.5 py-0.5 rounded bg-emerald-50 text-emerald-700">{c.category}</span>
                            <div className="flex items-center gap-2">
                              {isContestExpired(c) && (
                                <span className="text-[10px] font-bold bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">期限切れ</span>
                              )}
                              <span className="text-xs text-gray-400 font-mono">{c.date}</span>
                            </div>
                          </div>
                          <h3 className="font-bold text-base text-gray-900">{c.title}</h3>
                          <p className="text-xs text-gray-600 leading-relaxed">{c.description}</p>
                        </div>
                      ))
                    )}
                  </div>
                </div>

              ) : currentTab === '学術論文の検索' ? (
                <AcademicPaperSearch
                  key={JSON.stringify([schoolId, currentStudentId])}
                  storageKey={`lti_academic_references:${JSON.stringify([schoolId, currentStudentId])}`}
                />
              ) : currentTab === 'みんなの論文' ? (
                detailPaper ? (
                  <PaperDetailSplitView
                    detailPaper={detailPaper}
                    onBack={() => { setDetailPaper(null); setAiSuggestions([]); setAiError(''); }}
                    aiSuggestions={aiSuggestions}
                    aiLoading={aiLoading}
                    aiError={aiError}
                    onRetry={() => fetchContinuationSuggestions(detailPaper)}
                  />
                ) : (
                <div className="space-y-6">
                  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm flex items-center justify-between">
                    <div>
                      <h2 className="text-lg font-bold text-gray-900">みんなの論文ライブラリ</h2>
                      <p className="text-xs font-medium text-gray-500">全国の高校生が執筆した素晴らしい探究論文を参考にしてみましょう。</p>
                    </div>
                  </div>

                  <div className="relative">
                    <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      aria-label="論文を検索"
                      value={studentPaperSearchQuery}
                      onChange={(e) => setStudentPaperSearchQuery(e.target.value)}
                      placeholder="タイトル・著者・学校名・分野で検索..."
                      className="w-full max-w-md pl-10 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-400/20 focus:border-emerald-400"
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2" role="group" aria-label="論文の研究分野">
                    {['すべて', ...studentPaperFields].map((field) => {
                      const count = field === 'すべて'
                        ? studentSearchResults.length
                        : studentSearchResults.filter(p => p.field === field).length;
                      const selected = studentPaperFieldFilter === field;
                      return (
                        <button
                          key={field}
                          type="button"
                          aria-pressed={selected}
                          onClick={() => setStudentPaperFieldFilter(field)}
                          className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors flex items-center gap-1.5 ${selected ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:bg-emerald-50'}`}
                        >
                          {field}<span className={selected ? 'text-emerald-100' : 'text-gray-400'}>{count}</span>
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-xs text-gray-500" role="status" aria-live="polite">
                      公開中 {publishedList.length} 件中 {studentFilteredPapers.length} 件を表示
                    </p>
                    {(studentPaperFieldFilter !== 'すべて' || studentPaperSearchQuery !== '') && (
                      <button type="button" onClick={() => { setStudentPaperFieldFilter('すべて'); setStudentPaperSearchQuery(''); }} className="text-xs font-bold text-emerald-700 hover:underline">
                        絞り込みを解除
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {studentFilteredPapers.length === 0 ? (
                      <div className="col-span-full p-12 text-center bg-white rounded-2xl border border-gray-200 text-gray-400 text-xs font-bold">
                        {publishedList.length === 0 ? '現在公開されている論文はありません。' : '条件に一致する論文が見つかりませんでした。'}
                      </div>
                    ) : (
                      studentFilteredPapers.map((paper) => (
                        <div key={paper.id} className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-3">
                          <span className="text-xs font-bold px-2.5 py-0.5 rounded bg-emerald-50 text-emerald-700">
                            {paper.field}
                          </span>
                          <h3 className="font-bold text-base text-gray-900">{paper.title}</h3>
                          <p className="text-xs text-gray-500">🏫 {paper.schoolName} | 著者: {paper.author}</p>
                          <div className="pt-2 flex justify-end">
                            <button
                              onClick={() => openPaperDetail(paper)}
                              className="px-3.5 py-1.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 font-bold text-xs rounded-xl transition-colors flex items-center gap-1"
                            >
                              <Eye className="w-3.5 h-3.5" /> 論文を読む
                            </button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
                )

              ) : currentTab === '先生からのフィードバック' ? (
                <div className="space-y-6">
                  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-1">
                    <h2 className="text-lg font-bold text-gray-900">先生からのフィードバック</h2>
                    <p className="text-xs font-medium text-gray-500">AIによる添削をもとに、先生から届いたコメントの一覧です。</p>
                  </div>

                  {myFeedbackMessages.length === 0 ? (
                    <div className="p-12 text-center bg-white rounded-2xl border border-gray-200 text-gray-400 text-xs font-bold">
                      まだ先生からのフィードバックはありません。
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {myFeedbackMessages.map((m) => {
                        const isExpanded = !m.read || expandedFeedbackIds.has(m.id);

                        if (!isExpanded) {
                          // 既読・未展開：コンパクトな1行表示
                          return (
                            <button
                              key={m.id}
                              onClick={() => handleFeedbackCardClick(m)}
                              className="w-full bg-white p-3.5 rounded-xl border border-gray-200 shadow-sm hover:border-orange-200 hover:bg-gray-50 transition-colors flex items-center justify-between text-left"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <Bot className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                                <span className="text-xs font-bold text-gray-600 truncate">{m.paperTitle}</span>
                                <span className="text-[11px] text-gray-400 shrink-0">{m.teacherName} 先生 | {m.sentAt}</span>
                              </div>
                              <ChevronRight className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                            </button>
                          );
                        }

                        return (
                          <div key={m.id} className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4">
                            <button
                              onClick={() => handleFeedbackCardClick(m)}
                              className="w-full flex items-center justify-between text-left"
                            >
                              <div className="flex items-center gap-2">
                                {!m.read && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-rose-500 text-white shrink-0">NEW</span>
                                )}
                                <div>
                                  <h3 className="text-sm font-bold text-gray-900">{m.paperTitle}</h3>
                                  <p className="text-[11px] text-gray-400">{m.teacherName} 先生 | {m.sentAt}</p>
                                </div>
                              </div>
                              <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 flex items-center gap-1 shrink-0">
                                <Bot className="w-3 h-3" /> AI添削
                              </span>
                            </button>

                            {m.note && (
                              <p className="text-xs text-gray-700 bg-orange-50 border border-orange-100 rounded-xl p-3">💬 {m.note}</p>
                            )}

                            <div className="space-y-3">
                              <div className="rounded-xl border border-rose-100 bg-rose-50/50 p-4 space-y-2">
                                <p className="text-xs font-bold text-rose-700 flex items-center gap-1.5">
                                  <AlertCircle className="w-3.5 h-3.5" /> 修正点
                                </p>
                                {m.result.corrections.length === 0 ? (
                                  <p className="text-[11px] text-gray-400 italic">なし</p>
                                ) : (
                                  <ul className="space-y-1.5">
                                    {m.result.corrections.map((line, i) => (
                                      <li key={i} className="text-xs text-gray-700 leading-relaxed flex gap-2">
                                        <span className="text-rose-400 shrink-0">●</span>
                                        <span>{line}</span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>

                              <div className="rounded-xl border border-blue-100 bg-blue-50/50 p-4 space-y-2">
                                <p className="text-xs font-bold text-blue-700 flex items-center gap-1.5">
                                  <Lightbulb className="w-3.5 h-3.5" /> アドバイス
                                </p>
                                {m.result.advice.length === 0 ? (
                                  <p className="text-[11px] text-gray-400 italic">なし</p>
                                ) : (
                                  <ul className="space-y-1.5">
                                    {m.result.advice.map((line, i) => (
                                      <li key={i} className="text-xs text-gray-700 leading-relaxed flex gap-2">
                                        <span className="text-blue-400 shrink-0">●</span>
                                        <span>{line}</span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>

                              <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-4 space-y-2">
                                <p className="text-xs font-bold text-emerald-700 flex items-center gap-1.5">
                                  <FlaskConical className="w-3.5 h-3.5" /> 追加実験の方向性
                                </p>
                                {m.result.nextExperiments.length === 0 ? (
                                  <p className="text-[11px] text-gray-400 italic">なし</p>
                                ) : (
                                  <ul className="space-y-1.5">
                                    {m.result.nextExperiments.map((line, i) => (
                                      <li key={i} className="text-xs text-gray-700 leading-relaxed flex gap-2">
                                        <span className="text-emerald-400 shrink-0">●</span>
                                        <span>{line}</span>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            </div>

                            {m.read && (
                              <button
                                onClick={() => toggleFeedbackExpanded(m.id)}
                                className="text-[11px] font-bold text-gray-400 hover:text-gray-600 flex items-center gap-1"
                              >
                                <ChevronRight className="w-3 h-3 rotate-90" /> たたむ
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>

              ) : currentTab === 'アカウント設定' ? (
                /* 【要件①用】生徒側：表示名・パスワード変更画面 */
                <div className="space-y-6 max-w-2xl">
                  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-1">
                    <h2 className="text-lg font-bold text-gray-900">生徒アカウント設定</h2>
                    <p className="text-xs font-medium text-gray-500">ご自身の表示名（生徒氏名）やログインパスワードを変更できます。</p>
                  </div>

                  {studentProfileMessage && (
                    <div className="p-3.5 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-bold rounded-xl flex items-center gap-2">
                      <Check className="w-4 h-4" /> {studentProfileMessage}
                    </div>
                  )}

                  <form onSubmit={handleStudentProfileUpdate} className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-4">
                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-700">生徒ID (ログイン用 / 変更不可)</label>
                      <input
                        type="text"
                        value={loggedInStudent.id}
                        disabled
                        className="w-full px-4 py-2.5 bg-gray-100 border border-gray-300 rounded-xl text-xs font-medium text-gray-500 cursor-not-allowed font-mono"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-700">生徒表示名 (氏名)</label>
                      <input
                        type="text"
                        value={editStudentName}
                        onChange={(e) => setEditStudentName(e.target.value)}
                        className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-xs font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                        required
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-gray-700">新しいパスワード (変更する場合のみ入力)</label>
                      <input
                        type="password"
                        value={studentNewPass}
                        onChange={(e) => setStudentNewPass(e.target.value)}
                        placeholder="変更しない場合は空欄のまま"
                        className="w-full px-4 py-2.5 bg-gray-50 border border-gray-300 rounded-xl text-xs font-medium text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-600"
                      />
                    </div>

                    <button
                      type="submit"
                      className="py-2.5 px-5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl text-xs shadow-sm transition-colors"
                    >
                      変更を保存する
                    </button>
                  </form>
                </div>

              ) : (
                <div className="bg-white p-12 rounded-2xl border border-gray-200 shadow-sm text-center space-y-3">
                  <h2 className="text-lg font-bold text-gray-900">{currentTab}</h2>
                  <p className="text-xs text-gray-500">選択されたメニューのコンテンツ画面です。</p>
                </div>
              )}

            </div>
          </main>
        </div>
      </div>
    );
  }

  return null;
}