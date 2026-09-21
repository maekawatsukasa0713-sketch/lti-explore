Warning: truncated output (original token count: 63939)
Total output lines: 4288

import {AccountManagement} from './accounts';
import {BulkImport} from './BulkImport';
import {InsightApproval} from './InsightApproval';
import {featureMode,FeatureUnavailable} from './SchoolFeatures';
import { ResearchLibrary } from './ResearchLibrary';
import { ResearchDetail } from './ResearchDetail';
import { ReviewPanels } from './ReviewPanels';
import { analysisInput, invokeResearchAI } from './research-ai';
import { ScholarlySearch } from './ScholarlySearch';
'use client';
import React, { useState, useEffect } from 'react';
import {PublishedFields,AdminAnalytics} from './analytics';
import { CloudGate, useCloud, useCloudList, saveMyProfile, uploadPdf, PdfView, type Profile } from './cloud';
import { Home, BarChart3, Users, Settings, Search, LogOut, Lock, User, Check, ArrowLeft, UserCheck, ShieldCheck, UserCog, Building2, BookOpen, FileText, Bot, Trophy, ChevronRight, Upload, Send, Edit3, Trash2, CheckCircle2, XCircle, PieChart, FileUp, Eye, EyeOff, Clock, FileCheck, Globe, LockKeyhole, AlertCircle, Lightbulb, FlaskConical, GripVertical, PanelLeftClose, PanelLeftOpen } from 'lucide-react';

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
  sourceFile?: File;
  generatedAt?: string;
  basis?: string;
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
                <p className="text-xs text-gray-400 italic">まだメッセージのやり取りはありません。</p>
              ) : (
                previewPaper.messages.map(m => (
                  <div key={m.id} className={`p-3 rounded-xl text-xs ${m.sender === 'lti' ? 'bg-indigo-50 border border-indigo-100' : 'bg-orange-50 border border-orange-100'}`}>
                    <div className="flex items-center justify-between mb-1">
                      <span className={`font-bold ${m.sender === 'lti' ? 'text-indigo-700' : 'text-orange-700'}`}>
                        {m.sender === 'lti' ? '🏢 ' : '🧑‍🏫 '}{m.senderName}
                      </span>
                      <span className="text-xs text-gray-400 font-mono">{m.createdAt}</span>
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
                <p className="text-xs text-gray-400 pt-4 border-t border-gray-100">
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
            <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">AI提案</span>
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
                className="px-3 py-1.5 bg-white border border-amber-200 hover:bg-amber-100 text-amber-800 font-bold text-xs rounded-lg"
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
                    <span className="w-4 h-4 rounded-full bg-emerald-600 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                      {i + 1}
                    </span>
                    {s.title}
                  </p>
                  <p className="text-xs text-gray-600 leading-relaxed">{s.description}</p>
                  {s.tags && s.tags.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-1">
                      <span className="text-xs font-bold text-gray-400">アプローチ例</span>
                      {s.tags.map((t, ti) => (
                        <span key={ti} className="text-xs font-bold px-2 py-0.5 rounded bg-emerald-50 text-emerald-700">
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
          <p className="text-xs text-gray-400">入力すると、担当教員の画面にメッセージとして届きます。</p>
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
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
  const [publicationMessage,setPublicationMessage]=useState('');
  const [insightPaper,setInsightPaper]=useState<number|null>(null);
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
       …33939 tokens truncated…>

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
                      生徒の探究論文（Word・PDF）をドロップすると、AIが修正点・アドバイス・追加実験の方向性を指摘します。内容を確認・編集してから、生徒へメッセージとして送信できます。
                    </p>
                  </div>

                  <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-3">
                    <div className="border-2 border-dashed border-gray-300 hover:border-orange-400 rounded-xl p-6 text-center bg-gray-50 transition-colors relative cursor-pointer">
                      <input
                        type="file"
                        accept=".docx,.pdf"
                        multiple
                        onChange={(e) => { handleAiReviewFilesSelected(e.target.files); e.target.value = ''; }}
                        className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                      />
                      <div className="space-y-1 pointer-events-none">
                        <Bot className="w-8 h-8 text-orange-500 mx-auto" />
                        <p className="text-xs font-bold text-gray-700">クリックまたはドラッグ＆ドロップでWord・PDFファイルを選択</p>
                        <p className="text-xs text-gray-400">※ .docx・.pdf形式、1ファイル50MBまで。8MB超のPDFは抽出テキストをAIに送信します（図表画像は対象外）。</p>
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
                                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 flex items-center gap-1">
                                  <span className="w-2.5 h-2.5 border-2 border-gray-400 border-t-transparent rounded-full animate-spin" /> AI添削中...
                                </span>
                              )}
                              {item.status === 'done' && !item.sent && (
                                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">添削完了</span>
                              )}
                              {item.status === 'error' && !item.sent && (
                                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-amber-50 text-amber-700">要手動入力</span>
                              )}
                              {item.sent && (
                                <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 flex items-center gap-1">
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

                          {item.status !== 'processing' && <ReviewPanels result={item.result} generatedAt={item.generatedAt} basis={item.basis} readOnly={item.sent} onChange={(key,value)=>updateAiReviewResultField(item.id,key,value)}/>}
                          {item.sourceFile && !item.sent && item.status !== 'processing' && <button type="button" onClick={()=>void regenerateReview(item)} className="text-sm underline text-slate-600">結果を再生成</button>}

                          {item.status !== 'processing' && !item.sent && (
                            <div className="pt-3 border-t border-gray-100 space-y-3">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                                <div className="space-y-1">
                                  <label className="text-xs font-bold text-gray-500">送信先の生徒</label>
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
                                  <label className="text-xs font-bold text-gray-500">一言コメント（任意）</label>
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
                            <p className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-xl p-3">
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
                                  <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded font-bold text-xs">初期値 ()</span>
                                ) : (
                                  <span className="bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded font-bold text-xs">変更済み</span>
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

    const tabMode=(tab:string)=>featureMode(cloud.schools.find(s=>s.id===schoolId)?.feature_settings,'student',tab);
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
      .filter((m): m is typeof studentMenuBase[number] => !!m).filter(m=>tabMode(m.name)!=='hidden');

    return (
      <div className="lti-shell min-h-screen bg-gray-50 flex font-sans text-gray-900">
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

        <aside className={`lti-sidebar w-64 shrink-0 bg-white shadow-sm flex-col border-r border-gray-200 ${sidebarCollapsed?'hidden':'flex'}`}>
          <div className="h-16 flex items-center px-6 border-b border-gray-200 justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 bg-emerald-600 rounded-lg flex items-center justify-center text-white font-bold text-sm">L</div>
              <span className="text-xl font-extrabold text-gray-900 tracking-tight">LTI Explore</span>
            </div>
            <button type="button" onClick={()=>setSidebarCollapsed(true)} aria-label="メニューを閉じる" title="メニューを閉じる" className="p-2 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"><PanelLeftClose className="w-5 h-5"/></button>
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
                    <span className="truncate">{item.name}</span>{tabMode(item.name)!=='enabled'&&<span className="text-xs ml-auto">{tabMode(item.name)==='premium'?'プレミアム':'今後実装予定'}</span>}
                  </button>
                );
              })}
            </nav>
          </div>
        </aside>

        <div className="flex-1 flex flex-col min-w-0">
          <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-8 shadow-sm sticky top-0 z-10">
            <div className="flex items-center gap-3 w-96">
              {sidebarCollapsed&&<button type="button" onClick={()=>setSidebarCollapsed(false)} aria-label="メニューを開く" title="メニューを開く" className="p-2 rounded-lg text-gray-500 hover:bg-emerald-50 hover:text-emerald-700 shrink-0"><PanelLeftOpen className="w-5 h-5"/></button>}
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

          <main className="flex-1 min-w-0 p-4 md:p-6 xl:p-8 overflow-y-auto">
            <div className="max-w-7xl mx-auto space-y-6">

              {tabMode(currentTab)!=='enabled'?<FeatureUnavailable mode={tabMode(currentTab)}/>:currentTab === 'ホーム' ? (
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
                              <span className="text-xs font-mono text-gray-400">{n.date}</span>
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
                              <p className="text-xs text-gray-400 font-mono pt-1">提出日時: {submission.submittedAt}</p>
                              
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
                            <p className="text-xs text-gray-400 font-mono flex items-center gap-1">
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
                                <span className="text-xs font-bold bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full">期限切れ</span>
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
                detailPaper ? <ResearchDetail key={String(detailPaper.id)} paper={detailPaper} onBack={()=>setDetailPaper(null)} /> : <ResearchLibrary papers={papers} onOpen={p=>{setDetailPaper(p);setSidebarCollapsed(true);}} />
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
                                <span className="text-xs text-gray-400 shrink-0">{m.teacherName} 先生 | {m.sentAt}</span>
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
                                  <span className="text-xs font-bold px-1.5 py-0.5 rounded bg-rose-500 text-white shrink-0">NEW</span>
                                )}
                                <div>
                                  <h3 className="text-sm font-bold text-gray-900">{m.paperTitle}</h3>
                                  <p className="text-xs text-gray-400">{m.teacherName} 先生 | {m.sentAt}</p>
                                </div>
                              </div>
                              <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 flex items-center gap-1 shrink-0">
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
                                  <p className="text-xs text-gray-400 italic">なし</p>
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
                                  <p className="text-xs text-gray-400 italic">なし</p>
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
                                  <p className="text-xs text-gray-400 italic">なし</p>
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
                                className="text-xs font-bold text-gray-400 hover:text-gray-600 flex items-center gap-1"
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
