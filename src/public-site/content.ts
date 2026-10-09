import type { Locale } from '../lib/money.ts';
import { GITHUB_URL, type PublicPage } from './site.ts';

interface Section {
  readonly heading: string;
  readonly paragraphs: readonly string[];
  readonly steps?: readonly string[];
  readonly links?: readonly { readonly label: string; readonly href: string }[];
}
interface Article {
  readonly title: string;
  readonly description: string;
  readonly intro: string;
  readonly sections: readonly Section[];
}

export const articles: Record<PublicPage, Record<Locale, Article>> = {
  about: {
    en: {
      title: 'A budget for the money you actually have',
      description: 'Meet Open Budget Tracker: an open-source budget tracker with USD and LBP wallets, monthly planning, and English and Arabic support.',
      intro: 'Open Budget Tracker helps you see where your money is and what it is for. Plan your month in USD, track USD and Lebanese lira separately, and give the money you hold a clear job.',
      sections: [
        { heading: 'One budget, two useful questions', paragraphs: ['A wallet tells you where money is: cash in your pocket, a bank account, or a card. A plan item tells you what that money is for: groceries, rent, a bill, or a savings goal.', 'Keeping those questions connected makes a balance more useful. You can see how much is already set aside and how much is still ready to assign before deciding what to spend.'] },
        { heading: 'Built for USD and LBP, in English and Arabic', paragraphs: ['The monthly plan is sized in USD. Wallets, income, expenses, and amounts set aside can be tracked in USD and LBP. The two currencies keep their own balances, so a lira amount is never silently treated as dollars.', 'Switch between English and Arabic in the app. Arabic screens use a right-to-left layout and the same budgeting concepts, from the first setup through your everyday records.'] },
        { heading: 'Start with what you hold today', paragraphs: ['Create an account, set up a budget space, and add your wallets with their current balances. Assign available money to the things that matter this month, then record income and spending as they happen.', 'Bills, savings goals, investments, and loans help you keep the broader picture in view. Investment accounts and loans are tracked separately from spendable wallet money.'] },
        { heading: 'Open source, with room to improve', paragraphs: ['The code is public on GitHub under the MIT license. You can inspect it, run it yourself, report a problem, improve an Arabic translation, or propose a focused change.', 'This project grows through practical feedback. If something makes budgeting harder than it should be, tell us what you tried and what would have helped.'], links: [{ label: 'Help improve the app', href: '/contribute' }] },
      ],
    },
    ar: {
      title: 'ميزانية للأموال التي تملكها فعلًا',
      description: 'تعرّف على Open Budget Tracker، تطبيق ميزانية مفتوح المصدر بمحافظ بالدولار والليرة اللبنانية وخطة شهرية ودعم العربية والإنجليزية.',
      intro: 'يساعدك Open Budget Tracker على معرفة أين أموالك وما الغرض منها. خطّط للشهر بالدولار وتابع الدولار والليرة اللبنانية بشكل منفصل وخصّص للأموال التي تملكها وظيفة واضحة.',
      sections: [
        { heading: 'ميزانية واحدة وسؤالان مفيدان', paragraphs: ['تخبرك المحفظة أين توجد الأموال: نقد في جيبك أو حساب مصرفي أو بطاقة. ويخبرك بند الخطة بالغرض منها: الطعام أو الإيجار أو فاتورة أو هدف ادخار.', 'ربط السؤالين يجعل الرصيد أكثر فائدة. يمكنك معرفة المبالغ المخصّصة مسبقًا والمبالغ التي لا تزال جاهزة للتوزيع قبل اتخاذ قرار بالصرف.'] },
        { heading: 'للدولار والليرة، بالعربية والإنجليزية', paragraphs: ['يُحدَّد حجم الخطة الشهرية بالدولار. ويمكن متابعة المحافظ والدخل والمصروفات والمبالغ المخصّصة بالدولار والليرة. تحتفظ كل عملة برصيد مستقل، فلا يُعامَل مبلغ بالليرة كأنه دولارات.', 'يمكنك التبديل بين العربية والإنجليزية داخل التطبيق. تستخدم الشاشات العربية اتجاهًا من اليمين إلى اليسار ومفاهيم الميزانية نفسها من الإعداد الأول إلى التسجيل اليومي.'] },
        { heading: 'ابدأ بما تملكه اليوم', paragraphs: ['أنشئ حسابًا ومساحة للميزانية، ثم أضف محافظك بأرصدتها الحالية. وزّع المال المتاح على أولويات الشهر وسجّل الدخل والمصروفات عند حدوثها.', 'تساعدك الفواتير وأهداف الادخار والاستثمارات والقروض على رؤية الصورة الأوسع. تُتابَع حسابات الاستثمار والقروض بشكل منفصل عن الأموال القابلة للصرف في المحافظ.'] },
        { heading: 'مفتوح المصدر وقابل للتحسين', paragraphs: ['الكود متاح على GitHub بترخيص MIT. يمكنك الاطلاع عليه وتشغيله بنفسك والإبلاغ عن مشكلة وتحسين الترجمة العربية أو اقتراح تعديل محدّد.', 'يتطوّر المشروع بالملاحظات العملية. إذا واجهت خطوة تجعل إدارة الميزانية أصعب، أخبرنا بما حاولت فعله وما الذي كان سيساعدك.'], links: [{ label: 'ساعدنا في تحسين التطبيق', href: '/ar/contribute' }] },
      ],
    },
  },
  'how-it-works': {
    en: {
      title: 'How your budget fits together',
      description: 'Learn how to set up wallets, assign money to a monthly plan, record expenses, and track bills and savings in Open Budget Tracker.',
      intro: 'Your budget connects the cash you hold with the jobs you give it. Start with real balances, build a monthly plan, and keep it useful with a few everyday records.',
      sections: [
        { heading: '1. Add your wallets', paragraphs: ['A wallet represents a place you keep spendable money. Add the accounts, cash, and cards you want to track, choosing USD or LBP and entering each current balance.', 'An opening balance records money you already have. Later income is a separate record. This keeps your starting point distinct from what you earn during the month.'] },
        { heading: '2. Make a plan and fund it', paragraphs: ['Set your expected monthly income in USD and organise plan groups and items around your priorities. Items can cover everyday spending, reserves, savings goals, and loan payments.', 'Expected income helps size the plan; it is not cash in a wallet. Funding an item gives money you already hold a job. Money without a job stays ready to assign. You can move assigned money between items when priorities change.'] },
        { heading: '3. Record what happens', paragraphs: ['Record an expense with the wallet that paid and the plan item it belongs to. Record income when money arrives. Moving money between your own wallets is a transfer, rather than new income or everyday spending.', 'If an expense needs more money than the item has set aside, review the shortfall and choose how to cover it. Your activity history lets you review records and their effect on balances.'] },
        { heading: '4. Review bills, goals, and the bigger picture', paragraphs: ['Keep bills in your monthly plan and record their payments when paid. Use goals and reserves to set money aside for costs beyond today.', 'Investments and loans contribute to your net worth view, separately from spendable wallets. Review your overview and plan regularly to decide what needs funding next.'], links: [{ label: 'Read the USD & LBP guide', href: '/budgeting-usd-lbp' }] },
      ],
    },
    ar: {
      title: 'كيف تتكامل أجزاء ميزانيتك',
      description: 'تعلّم إعداد المحافظ وتوزيع الأموال على الخطة الشهرية وتسجيل المصروفات ومتابعة الفواتير والادخار في Open Budget Tracker.',
      intro: 'تربط ميزانيتك بين الأموال التي تملكها والأغراض التي تخصّصها لها. ابدأ بالأرصدة الفعلية وأنشئ خطة شهرية وحافظ على فائدتها بتسجيل العمليات اليومية.',
      sections: [
        { heading: '١. أضف محافظك', paragraphs: ['تمثّل المحفظة مكانًا تحتفظ فيه بأموال قابلة للصرف. أضف الحسابات والنقد والبطاقات التي تريد متابعتها وحدّد الدولار أو الليرة وأدخل الرصيد الحالي لكل منها.', 'يسجّل الرصيد الافتتاحي الأموال التي تملكها بالفعل. أمّا الدخل اللاحق فيُسجَّل بعملية مستقلة، لتبقى نقطة البداية منفصلة عمّا تكسبه خلال الشهر.'] },
        { heading: '٢. أنشئ خطة وموّلها', paragraphs: ['حدّد دخلك الشهري المتوقّع بالدولار ونظّم مجموعات الخطة وبنودها بحسب أولوياتك. يمكن أن تشمل البنود المصروفات اليومية والاحتياطي وأهداف الادخار ودفعات القروض.', 'يساعد الدخل المتوقّع في تحديد حجم الخطة، لكنه ليس مالًا موجودًا في المحفظة. تمويل بند يعني تخصيص مال تملكه بالفعل لغرض محدّد. وما لم تخصّصه يبقى جاهزًا للتوزيع. يمكنك نقل المال بين البنود عند تغيّر الأولويات.'] },
        { heading: '٣. سجّل ما يحدث', paragraphs: ['سجّل المصروف مع المحفظة التي دفعت وبند الخطة الذي يخصّه. وسجّل الدخل عند وصول الأموال. نقل المال بين محافظك هو تحويل، وليس دخلًا جديدًا أو مصروفًا يوميًا.', 'إذا احتاج مصروف إلى مبلغ أكبر مما خُصّص للبند، راجع النقص واختر كيفية تغطيته. يتيح لك سجل الحركة مراجعة العمليات وتأثيرها على الأرصدة.'] },
        { heading: '٤. راجع الفواتير والأهداف والصورة الأوسع', paragraphs: ['أبقِ الفواتير ضمن خطتك الشهرية وسجّل دفعاتها عند الدفع. واستخدم الأهداف والاحتياطي لتخصيص المال لتكاليف تتجاوز احتياجات اليوم.', 'تدخل الاستثمارات والقروض في عرض صافي الثروة بشكل منفصل عن المحافظ القابلة للصرف. راجع النظرة العامة والخطة بانتظام لتقرّر ما يحتاج إلى تمويل بعد ذلك.'], links: [{ label: 'اقرأ دليل الدولار والليرة', href: '/ar/budgeting-usd-lbp' }] },
      ],
    },
  },
  'budgeting-usd-lbp': {
    en: {
      title: 'Budgeting with USD and Lebanese lira',
      description: 'A practical guide to a monthly budget in USD with separate USD and LBP balances, wallet records, and clearly labelled reference conversions.',
      intro: 'When you hold both dollars and Lebanese lira, a useful budget needs to keep the currencies clear. Open Budget Tracker sizes your monthly plan in USD while tracking actual USD and LBP balances separately.',
      sections: [
        { heading: 'Keep a wallet for each currency balance', paragraphs: ['Add your dollar cash as a USD wallet and your lira cash as an LBP wallet. Do the same for the other accounts you want to track. Record each balance in its own currency.', 'For example, USD 100 and LBP 1,000,000 are two balances. Do not enter their sum as 1,000,100. Keeping them separate shows what you can actually pay from each wallet.'] },
        { heading: 'Size the plan in dollars; assign each currency separately', paragraphs: ['Use expected monthly income in USD to size your plan groups and items. Then assign available USD and available LBP to the items you intend to fund. A plan is a target; assigning is how you set aside money you already hold.', 'If you hold USD 100, assigning USD 30 to groceries leaves USD 70 ready to assign. Assigning lira to groceries is a separate allocation and does not reduce that dollar balance.'] },
        { heading: 'Record the currency you actually pay', paragraphs: ['If you pay for groceries in LBP, record the expense from your LBP wallet and the groceries item. If you pay in USD, use the USD wallet. The record should reflect the money that changed hands.', 'When you exchange currencies, use the exchange action and record the actual amounts given and received. Moving between two wallets in the same currency uses a transfer. Neither operation is new income.'] },
        { heading: 'Treat a reference conversion as an estimate', paragraphs: ['You can set a dated LBP-per-USD reference rate in Settings. Approximate USD hints use that reference to help you compare amounts; they do not change the underlying USD and LBP records.', 'Use the rate relevant to your own tracking and check actual exchange amounts when recording an exchange. The app’s reference rate is entered by you, rather than a promise of a live market quote.'], links: [{ label: 'See how wallets and the plan connect', href: '/how-it-works' }] },
      ],
    },
    ar: {
      title: 'إدارة الميزانية بالدولار والليرة اللبنانية',
      description: 'دليل عملي لخطة شهرية بالدولار مع أرصدة مستقلة بالدولار والليرة وسجلات للمحافظ وتحويلات مرجعية تقريبية موضّحة.',
      intro: 'عندما تملك الدولار والليرة اللبنانية معًا، تحتاج إلى ميزانية توضّح الفرق بين العملتين. يحدّد Open Budget Tracker حجم الخطة الشهرية بالدولار مع متابعة الأرصدة الفعلية لكل عملة بشكل منفصل.',
      sections: [
        { heading: 'محفظة لكل رصيد بعملته', paragraphs: ['أضف النقد بالدولار في محفظة USD والنقد بالليرة في محفظة LBP. وافعل الأمر نفسه للحسابات الأخرى التي تريد متابعتها. سجّل كل رصيد بعملته.', 'مثلًا، ١٠٠ دولار و١٬٠٠٠٬٠٠٠ ليرة رصيدان مختلفان. لا تجمعهما وتُدخل ١٬٠٠٠٬١٠٠ كرصيد واحد. الفصل بينهما يوضّح ما يمكنك دفعه فعلًا من كل محفظة.'] },
        { heading: 'حدّد حجم الخطة بالدولار ووزّع كل عملة على حدة', paragraphs: ['استخدم الدخل الشهري المتوقّع بالدولار لتحديد حجم مجموعات الخطة وبنودها. ثم وزّع الدولار المتاح والليرة المتاحة على البنود التي تريد تمويلها. الخطة هدف، والتوزيع هو تخصيص مال تملكه بالفعل.', 'إذا كنت تملك ١٠٠ دولار وخصّصت ٣٠ دولارًا للطعام، يبقى ٧٠ دولارًا جاهزًا للتوزيع. تخصيص الليرة للطعام عملية منفصلة ولا يقلّل رصيد الدولار.'] },
        { heading: 'سجّل العملة التي دفعت بها فعلًا', paragraphs: ['إذا دفعت ثمن الطعام بالليرة، سجّل المصروف من محفظة الليرة وعلى بند الطعام. وإذا دفعت بالدولار فاستخدم محفظة الدولار. يجب أن يعكس السجل الأموال التي دُفعت فعلًا.', 'عند تبديل العملات استخدم عملية الصرف وسجّل المبالغ الفعلية المدفوعة والمستلمة. أمّا النقل بين محفظتين بالعملة نفسها فيكون تحويلًا. ولا تُعدّ أي من العمليتين دخلًا جديدًا.'] },
        { heading: 'التحويل المرجعي تقدير تقريبي', paragraphs: ['يمكنك تحديد سعر مرجعي مؤرّخ لليرة مقابل الدولار في الإعدادات. تستخدم تلميحات القيمة التقريبية بالدولار هذا السعر للمقارنة، لكنها لا تغيّر السجلات الأصلية بالدولار والليرة.', 'استخدم السعر المناسب لمتابعتك وتحقّق من مبالغ الصرف الفعلية عند تسجيل العملية. السعر المرجعي في التطبيق تدخله أنت، وليس وعدًا بسعر سوق مباشر.'], links: [{ label: 'اعرف كيف ترتبط المحافظ بالخطة', href: '/ar/how-it-works' }] },
      ],
    },
  },
  contribute: {
    en: {
      title: 'Help improve Open Budget Tracker',
      description: 'Contribute code, Arabic translations, usability feedback, and bug reports to the open-source Open Budget Tracker budget tracker on GitHub.',
      intro: 'You do not have to write code to help. A clear bug report, a better translation, or an explanation of a confusing step can make the next person’s budget easier to manage.',
      sections: [
        { heading: 'Report a problem or share an idea', paragraphs: ['Open a GitHub issue with the screen you used, the steps you followed, what happened, and what you expected. Include your browser and whether you were using English or Arabic.', 'Use made-up amounts and remove personal details from screenshots. Describe an idea through the problem it would solve and a practical example. Please search existing issues first so related feedback stays together.'], links: [{ label: 'Browse issues and report a problem', href: `${GITHUB_URL}/issues` }] },
        { heading: 'Improve the words and the experience', paragraphs: ['Help us make Arabic translations natural and consistent, check right-to-left layouts, or point out a budgeting explanation that is difficult to follow.', 'Documentation, keyboard accessibility, mobile layouts, and clearer setup instructions are useful contributions too. Describe the screen and language involved so someone can reproduce your experience.'] },
        { heading: 'Contribute code', paragraphs: ['The project uses React and TypeScript with Postgres/Supabase. The source is available under the MIT license. Start with the README and contribution guide for the local preview and verification commands.', 'For a substantial change, discuss the problem in an issue before building it. Keep pull requests focused, explain the resulting behavior, and include the checks you ran. Use synthetic data when developing and sharing examples.'], links: [{ label: 'Read the contribution guide', href: `${GITHUB_URL}/blob/main/CONTRIBUTING.md` }, { label: 'Read the project README', href: `${GITHUB_URL}#readme` }] },
        { heading: 'A useful first contribution', paragraphs: ['Pick one problem you can explain clearly and reproduce locally. A small correction to an Arabic label or a focused fix for a mobile layout is a good starting point.'], steps: ['Find an existing issue or describe the problem in a new one.', 'Follow the README to run the local preview with demonstration data.', 'Make a focused change and verify the affected behavior.', 'Open a pull request explaining the change and how you checked it.'] },
      ],
    },
    ar: {
      title: 'ساعدنا في تحسين Open Budget Tracker',
      description: 'ساهم بالكود أو الترجمة العربية أو ملاحظات الاستخدام أو تقارير الأخطاء في تطبيق الميزانية المفتوح المصدر Open Budget Tracker على GitHub.',
      intro: 'لست بحاجة إلى كتابة الكود للمساعدة. تقرير واضح عن مشكلة أو ترجمة أفضل أو شرح لخطوة مربكة يمكن أن يجعل إدارة الميزانية أسهل للمستخدم التالي.',
      sections: [
        { heading: 'أبلغ عن مشكلة أو شارك فكرة', paragraphs: ['افتح بلاغًا على GitHub يذكر الشاشة التي استخدمتها والخطوات التي اتّبعتها وما حدث وما كنت تتوقّعه. أضف اسم المتصفّح وما إذا كنت تستخدم العربية أو الإنجليزية.', 'استخدم مبالغ وهمية واحذف التفاصيل الشخصية من لقطات الشاشة. اشرح الفكرة من خلال المشكلة التي تحلّها ومثال عملي. ابحث في البلاغات الموجودة أولًا لتبقى الملاحظات المرتبطة معًا.'], links: [{ label: 'تصفّح البلاغات وأبلغ عن مشكلة', href: `${GITHUB_URL}/issues` }] },
        { heading: 'حسّن اللغة وتجربة الاستخدام', paragraphs: ['ساعدنا في جعل الترجمة العربية طبيعية ومتّسقة، وتحقّق من اتجاه الشاشات من اليمين إلى اليسار، أو نبّهنا إلى شرح يصعب فهمه.', 'تحسين التوثيق وإمكانية الاستخدام بلوحة المفاتيح وتنسيق الهاتف وتعليمات الإعداد مساهمات مفيدة أيضًا. حدّد الشاشة واللغة حتى يتمكّن شخص آخر من إعادة التجربة.'] },
        { heading: 'ساهم في الكود', paragraphs: ['يستخدم المشروع React وTypeScript مع Postgres وSupabase. الكود متاح بترخيص MIT. ابدأ بملف README ودليل المساهمة لمعرفة تشغيل المعاينة المحلية وأوامر التحقّق.', 'ناقش المشكلة في بلاغ قبل تنفيذ تعديل كبير. اجعل طلب الدمج محدّدًا واشرح السلوك الناتج والفحوصات التي أجريتها. استخدم بيانات تجريبية أثناء التطوير ومشاركة الأمثلة.'], links: [{ label: 'اقرأ دليل المساهمة', href: `${GITHUB_URL}/blob/main/CONTRIBUTING.md` }, { label: 'اقرأ ملف README للمشروع', href: `${GITHUB_URL}#readme` }] },
        { heading: 'مساهمة أولى مفيدة', paragraphs: ['اختر مشكلة يمكنك شرحها بوضوح وإعادة حدوثها محليًا. تصحيح عبارة عربية أو إصلاح محدّد لتنسيق الهاتف بداية مناسبة.'], steps: ['ابحث عن بلاغ موجود أو افتح بلاغًا يشرح المشكلة.', 'اتّبع README لتشغيل المعاينة المحلية بالبيانات التجريبية.', 'نفّذ تعديلًا محدّدًا وتحقّق من السلوك المتأثّر.', 'افتح طلب دمج يشرح التعديل وكيف تحقّقت منه.'] },
      ],
    },
  },
};
