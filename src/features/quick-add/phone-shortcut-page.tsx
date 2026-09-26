import { useId, useState } from 'react';
import { PageHeader } from '../control-room/page-header.js';
import type { Locale } from '../loans/types.js';

const t = (locale: Locale, en: string, ar: string) => (locale === 'ar' ? ar : en);

type LinkKind = 'expense' | 'income';

export interface PhoneShortcutPageProps {
  locale: Locale;
  /** The site's origin the quick-add links are built from. */
  origin?: string;
  /** Injected for tests; defaults to the asynchronous Clipboard API. */
  writeClipboard?(text: string): Promise<void>;
}

function writeWithClipboardApi(text: string): Promise<void> {
  if (!navigator.clipboard) return Promise.reject(new Error('Clipboard unavailable'));
  return navigator.clipboard.writeText(text);
}

function CopyField(props: { label: string; value: string; copyLabel: string; buttonText: string; onCopy(): void }) {
  return (
    <div className="cr-copy-field">
      <label className="cr-field">
        {props.label}
        <input type="text" readOnly dir="ltr" value={props.value} onFocus={(event) => event.currentTarget.select()} />
      </label>
      <button type="button" className="cr-button" aria-label={props.copyLabel} onClick={props.onCopy}>
        {props.buttonText}
      </button>
    </div>
  );
}

/**
 * Manage → "Add from your phone": the quick-add links and how to put them
 * one tap away. Android shows the installed app's long-press shortcuts
 * (from the web app manifest); iPhone does not support manifest shortcuts,
 * so it uses a Shortcuts-app "Open URLs" action instead.
 */
export function PhoneShortcutPage(props: PhoneShortcutPageProps) {
  const { locale } = props;
  // Arabic steps quote English UI terms (the phone shows the manifest's
  // English shortcut labels); each sits in <bdi> so bidi keeps its order,
  // with a no-break space so a two-word label never wraps across lines.
  const ar = locale === 'ar';
  const origin = props.origin ?? window.location.origin;
  const writeClipboard = props.writeClipboard ?? writeWithClipboardApi;
  const [notice, setNotice] = useState('');
  const linksId = useId();
  const iphoneId = useId();
  const androidId = useId();
  const links: Record<LinkKind, string> = { expense: `${origin}/?add=expense`, income: `${origin}/?add=income` };

  const copy = (kind: LinkKind) => {
    setNotice('');
    void writeClipboard(links[kind])
      .then(() => setNotice(kind === 'expense'
        ? t(locale, 'Expense link copied.', 'تم نسخ رابط المصروف.')
        : t(locale, 'Income link copied.', 'تم نسخ رابط الدخل.')))
      .catch(() => setNotice(t(locale,
        'Copying isn’t allowed here. Press and hold the link to copy it.',
        'النسخ غير مسموح هنا. اضغط مطولًا على الرابط لنسخه.')));
  };

  return (
    <>
      <PageHeader
        title={t(locale, 'Add from your phone', 'الإضافة من هاتفك')}
        subtitle={t(locale, 'Open Add expense in one tap, without going through the menu.', 'افتح «إضافة مصروف» بلمسة واحدة دون المرور بالقائمة.')}
      />
      <section className="cr-card" aria-labelledby={linksId}>
        <div className="cr-section-header"><h2 id={linksId}>{t(locale, 'Quick-add links', 'روابط الإضافة السريعة')}</h2></div>
        <p className="cr-helper">{t(locale, 'Use these links to open an expense or income form directly from your phone.', 'استخدم هذه الروابط لفتح نموذج مصروف أو دخل مباشرةً من هاتفك.')}</p>
        <CopyField
          label={t(locale, 'Expense link', 'رابط المصروف')}
          value={links.expense}
          copyLabel={t(locale, 'Copy expense link', 'نسخ رابط المصروف')}
          buttonText={t(locale, 'Copy', 'نسخ')}
          onCopy={() => copy('expense')}
        />
        <CopyField
          label={t(locale, 'Income link', 'رابط الدخل')}
          value={links.income}
          copyLabel={t(locale, 'Copy income link', 'نسخ رابط الدخل')}
          buttonText={t(locale, 'Copy', 'نسخ')}
          onCopy={() => copy('income')}
        />
        <p className="cr-helper">{t(locale, 'The link only opens the form. Nothing is saved until you tap Save.', 'الرابط يفتح النموذج فقط. لا يُحفظ شيء حتى تضغط «حفظ».')}</p>
        <p className="cr-helper" role="status">{notice}</p>
      </section>
      <div className="cr-phone-setup">
        <section className="cr-card" aria-labelledby={iphoneId}>
          <div className="cr-section-header"><h2 id={iphoneId}>{t(locale, 'iPhone', 'آيفون')}</h2></div>
          <ol className="cr-steps">
            <li>{t(locale, 'Open the Shortcuts app and tap +.', 'افتح تطبيق «الاختصارات» واضغط +.')}</li>
            <li>{ar ? <>أضف إجراء فتح الروابط (<bdi>Open{'\u00a0'}URLs</bdi>) والصق رابط المصروف.</> : 'Add the “Open URLs” action and paste the expense link.'}</li>
            <li>{t(locale, 'Name it “Add expense”, then choose Add to Home Screen.', 'سمِّه «إضافة مصروف» ثم اختر «إضافة إلى الشاشة الرئيسية».')}</li>
          </ol>
          <p className="cr-helper">{ar ? <>يمكنك أيضًا تشغيله عبر <bdi>Siri</bdi> بقول اسمه، أو من زر الإجراء.</> : 'You can also run it with Siri by saying its name, or from the Action Button.'}</p>
        </section>
        <section className="cr-card" aria-labelledby={androidId}>
          <div className="cr-section-header"><h2 id={androidId}>{t(locale, 'Android', 'أندرويد')}</h2></div>
          <ol className="cr-steps">
            <li>{ar ? <>افتح هذا الموقع في <bdi>Chrome</bdi>، ثم القائمة ⋮ واختر «تثبيت التطبيق» (أو «إضافة إلى الشاشة الرئيسية»).</> : 'Open this site in Chrome, open the ⋮ menu and choose Install app (or Add to Home screen).'}</li>
            <li>{ar ? <>اضغط مطولًا على أيقونة <bdi>Budget</bdi> واختر «<bdi>Add{'\u00a0'}expense</bdi>».</> : 'Press and hold the Budget icon and choose Add expense.'}</li>
          </ol>
          <p className="cr-helper">{ar ? <>اسحب «<bdi>Add{'\u00a0'}expense</bdi>» من تلك القائمة لتبقى على شاشتك الرئيسية.</> : 'Drag Add expense out of that menu to keep it on your home screen.'}</p>
        </section>
      </div>
    </>
  );
}
