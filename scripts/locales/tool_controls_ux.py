"""Controls for watermark, page numbers, pictures, protect and images, in
the same language order as strings.py."""

ROWS = [
    ("Ink for text and marks", "متن اور نشانات کی سیاہی", "حبر النص والعلامات", "文字和标记的颜色", "टेक्स्ट और निशानों की स्याही", "Tinta del texto y las marcas", "Encre du texte et des marques", "Цвет текста и отметок", "Tinta do texto e das marcas"),
    ("Text in blue", "نیلا متن", "نص أزرق", "蓝色文字", "नीला टेक्स्ट", "Texto en azul", "Texte en bleu", "Синий текст", "Texto em azul"),
    ("Text in black", "سیاہ متن", "نص أسود", "黑色文字", "काला टेक्स्ट", "Texto en negro", "Texte en noir", "Чёрный текст", "Texto em preto"),
    ("Top", "اوپر", "الأعلى", "顶部", "ऊपर", "Arriba", "En haut", "Вверху", "Em cima"),
    ("Foot", "نیچے", "الأسفل", "底部", "नीचे", "Abajo", "En bas", "Внизу", "Embaixo"),
    ("Align", "سیدھ", "المحاذاة", "对齐", "संरेखण", "Alinear", "Alignement", "Выравнивание", "Alinhar"),
    ("Left", "بائیں", "يسار", "靠左", "बाएँ", "Izquierda", "Gauche", "Слева", "Esquerda"),
    ("Middle", "درمیان", "الوسط", "居中", "बीच में", "Centro", "Milieu", "По центру", "Centro"),
    ("Right", "دائیں", "يمين", "靠右", "दाएँ", "Derecha", "Droite", "Справа", "Direita"),
    # Sizes and amounts, shared by several tools.
    ("Small", "چھوٹا", "صغير", "小", "छोटा", "Pequeño", "Petit", "Маленький", "Pequeno"),
    ("Medium", "درمیانہ", "متوسط", "中", "मध्यम", "Medio", "Moyen", "Средний", "Médio"),
    ("Large", "بڑا", "كبير", "大", "बड़ा", "Grande", "Grand", "Большой", "Grande"),
    # Pictures to PDF.
    ("Orientation", "رخ", "الاتجاه", "方向", "दिशा", "Orientación", "Orientation", "Ориентация", "Orientação"),
    ("Portrait", "عمودی", "عمودي", "纵向", "पोर्ट्रेट", "Vertical", "Portrait", "Книжная", "Retrato"),
    ("Landscape", "افقی", "أفقي", "横向", "लैंडस्केप", "Horizontal", "Paysage", "Альбомная", "Paisagem"),
    ("Margin", "حاشیہ", "الهامش", "页边距", "हाशिया", "Margen", "Marge", "Поля", "Margem"),
    ("None", "کوئی نہیں", "بدون", "无", "कोई नहीं", "Sin margen", "Sans", "Без полей", "Sem margem"),
    ("Narrow", "تنگ", "ضيق", "窄", "पतला", "Estrecho", "Étroite", "Узкие", "Estreita"),
    ("Normal", "عام", "عادي", "普通", "सामान्य", "Normal", "Normale", "Обычные", "Normal"),
    # PDF to pictures.
    ("Format", "فارمیٹ", "التنسيق", "格式", "फ़ॉर्मैट", "Formato", "Format", "Формат", "Formato"),
    ("Quality", "معیار", "الجودة", "质量", "गुणवत्ता", "Calidad", "Qualité", "Качество", "Qualidade"),
    ("For screens", "اسکرین کے لیے", "للشاشات", "适合屏幕", "स्क्रीन के लिए", "Para pantallas", "Pour l’écran", "Для экрана", "Para telas"),
    ("Standard", "معیاری", "قياسية", "标准", "मानक", "Estándar", "Standard", "Стандартное", "Padrão"),
    ("For printing", "پرنٹ کے لیے", "للطباعة", "适合打印", "प्रिंट के लिए", "Para imprimir", "Pour l’impression", "Для печати", "Para impressão"),
    ("Pages are drawn at {n} dots to the inch.", "صفحات {n} ڈاٹس فی انچ پر بنائے جاتے ہیں۔", "تُرسم الصفحات بدقة {n} نقطة في البوصة.", "页面以每英寸 {n} 点的分辨率绘制。", "पृष्ठ {n} डॉट प्रति इंच पर बनाए जाते हैं।", "Las páginas se dibujan a {n} puntos por pulgada.", "Les pages sont rendues à {n} points par pouce.", "Страницы рисуются с разрешением {n} точек на дюйм.", "As páginas são desenhadas a {n} pontos por polegada."),
    # Page numbers.
    ("Start at", "شروعاتی نمبر", "رقم البداية", "起始页码", "शुरुआती संख्या", "Empezar en", "Commencer à", "Начать с", "Começar em"),
    ("Use a whole number, 1 or more.", "1 یا اس سے بڑا پورا عدد لکھیں۔", "اكتب عددًا صحيحًا، 1 أو أكثر.", "请输入不小于 1 的整数。", "1 या उससे बड़ी पूर्ण संख्या लिखें।", "Usa un número entero, 1 o mayor.", "Saisissez un nombre entier, 1 ou plus.", "Введите целое число от 1.", "Use um número inteiro, 1 ou maior."),
    ("No number on the first page", "پہلے صفحے پر نمبر نہ لگائیں", "بلا رقم على الصفحة الأولى", "首页不加页码", "पहले पृष्ठ पर संख्या न लगाएँ", "Sin número en la primera página", "Pas de numéro sur la première page", "Без номера на первой странице", "Sem número na primeira página"),
    # Watermark.
    ("How many", "کتنے", "العدد", "数量", "कितने", "Cuántas", "Combien", "Сколько", "Quantas"),
    ("One", "ایک", "واحدة", "一个", "एक", "Una", "Une seule", "Одна", "Uma"),
    ("Repeated", "بار بار", "متكررة", "重复", "बार-बार", "Repetida", "Répétée", "Повтор", "Repetida"),
    ("Strength", "گہرائی", "الشدة", "深浅", "गहराई", "Intensidad", "Intensité", "Тон", "Intensidade"),
    ("Faint", "ہلکا", "خافت", "浅", "हल्का", "Tenue", "Pâle", "Светлый", "Fraco"),
    ("Strong", "گہرا", "قوي", "深", "गहरा", "Fuerte", "Fort", "Тёмный", "Forte"),
    ("Red", "سرخ", "أحمر", "红色", "लाल", "Rojo", "Rouge", "Красный", "Vermelho"),
    ("Blue", "نیلا", "أزرق", "蓝色", "नीला", "Azul", "Bleu", "Синий", "Azul"),
    ("Angle", "زاویہ", "الزاوية", "角度", "कोण", "Ángulo", "Angle", "Наклон", "Ângulo"),
    ("Slanted", "ترچھا", "مائل", "倾斜", "तिरछा", "Inclinado", "En biais", "Наискосок", "Inclinado"),
    ("Straight", "سیدھا", "مستقيم", "水平", "सीधा", "Recto", "Droit", "Прямо", "Reto"),
    # Protect.
    ("Allow printing", "پرنٹ کرنے کی اجازت دیں", "السماح بالطباعة", "允许打印", "प्रिंट करने दें", "Permitir imprimir", "Autoriser l’impression", "Разрешить печать", "Permitir impressão"),
    ("Allow copying text", "متن کاپی کرنے کی اجازت دیں", "السماح بنسخ النص", "允许复制文字", "टेक्स्ट कॉपी करने दें", "Permitir copiar el texto", "Autoriser la copie du texte", "Разрешить копировать текст", "Permitir copiar o texto"),
    ("Allow changes", "تبدیلیوں کی اجازت دیں", "السماح بالتعديل", "允许修改", "बदलाव करने दें", "Permitir cambios", "Autoriser les modifications", "Разрешить изменения", "Permitir alterações"),
    ("Most PDF readers keep to these limits, but a reader can choose to ignore them.", "زیادہ تر PDF ریڈر ان پابندیوں کا خیال رکھتے ہیں، مگر کوئی ریڈر انہیں نظرانداز بھی کر سکتا ہے۔", "تلتزم معظم برامج قراءة PDF بهذه القيود، لكن يمكن لأي برنامج أن يتجاهلها.", "大多数 PDF 阅读器会遵守这些限制，但阅读器也可以选择忽略。", "ज़्यादातर PDF रीडर इन पाबंदियों को मानते हैं, पर कोई रीडर इन्हें अनदेखा भी कर सकता है।", "La mayoría de los lectores de PDF respetan estos límites, pero un lector puede optar por ignorarlos.", "La plupart des lecteurs PDF respectent ces limites, mais un lecteur peut choisir de les ignorer.", "Большинство программ для PDF соблюдают эти ограничения, но программа может их и проигнорировать.", "A maioria dos leitores de PDF respeita esses limites, mas um leitor pode optar por ignorá-los."),
]
