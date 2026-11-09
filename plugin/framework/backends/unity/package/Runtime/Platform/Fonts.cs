using System;
using System.Collections.Generic;
using System.Reflection;
using FairyGUI;
using TMPro;
using UnityEngine;
using UnityEngine.TextCore.LowLevel;

namespace LGUI
{
    public static partial class Platform
    {
        // Project fonts are drawn with TextMesh Pro (SDF). The font asset is dynamic: a glyph is rendered into the atlas the
        // first time it is shown (nothing is baked in the Editor), and a new atlas texture is added when one is full.
        // Sampling 64 pt with 6 px padding (about 10%) on 2048 x 2048 atlases: roughly 800 CJK glyphs per atlas.
        const int SamplingPointSize = 64;
        const int AtlasPadding = 6;
        const int AtlasSize = 2048;

        // System fonts tried, in order, as the TMP fallback for characters that are not in the project font subset
        // (chat, player names). The first one found on this device is used for every project font.
        static readonly string[][] FallbackCandidates =
        {
            new[] { "PingFang SC", "Regular" },          // iOS, macOS
            new[] { "Noto Sans CJK SC", "Regular" },     // Android (AOSP and most vendors), many Linux desktops
            new[] { "Noto Sans SC", "Regular" },
            new[] { "Source Han Sans SC", "Regular" },
            new[] { "Microsoft YaHei", "Regular" },      // Windows
            new[] { "Droid Sans Fallback", "Regular" },  // older Android
            new[] { "WenQuanYi Micro Hei", "Regular" },  // Linux
        };

        static bool _fallbackSearched;
        static TMP_FontAsset _fallback;
        static string _fallbackName = "";

        static void FindFallback()
        {
            if (_fallbackSearched) return;
            _fallbackSearched = true;
            foreach (string[] candidate in FallbackCandidates)
            {
                // Returns null when no installed font has this family and style.
                TMP_FontAsset asset = TMP_FontAsset.CreateFontAsset(candidate[0], candidate[1], SamplingPointSize);
                if (asset == null) continue;
                asset.name = candidate[0];
                _fallback = asset;
                _fallbackName = candidate[0];
                return;
            }
        }

        /// <summary>
        /// Registers a project font with FairyGUI under its name, as a FairyGUI <see cref="TMPFont"/> that asks TMP for Regular
        /// glyphs only (<see cref="ProjectTMPFont"/>). The source is the
        /// subset that lgui unity export wrote to Assets/LGUI/Resources/UI/fonts/&lt;name&gt;.ttf|.otf (imported by Unity as a
        /// Font with its font data). The system fallback font (if any) is attached to it. Returns false when the resource is
        /// missing, is not a Font, or TMP cannot build a font asset from it; the TypeScript backend turns that into LGUI-RT-181.
        /// </summary>
        public static bool RegisterFont(string name, string resourcePath)
        {
            Font font = Resources.Load<Font>(resourcePath);
            if (font == null) return false;
            TMP_FontAsset asset = TMP_FontAsset.CreateFontAsset(font, SamplingPointSize, AtlasPadding, GlyphRenderMode.SDFAA,
                AtlasSize, AtlasSize, AtlasPopulationMode.Dynamic, true);
            if (asset == null) return false;
            asset.name = name;
            FindFallback();
            if (_fallback != null) asset.fallbackFontAssetTable = new List<TMP_FontAsset> { _fallback };
            var tmp = new ProjectTMPFont();
            tmp.name = name;
            tmp.fontAsset = asset;
            FontManager.RegisterFont(tmp, name);
            return true;
        }

        // FairyGUI's TMPFont asks TMP for glyphs of weight Medium by default (TMPFont.cs:51) and Bold for bold text
        // (TMPFont.cs:316). The font assets built above have no typefaces in their font weight table, and for a weight other
        // than Regular TMP looks only for an alternative typeface and does not add the glyph from the font file: the glyph is
        // missing, the text has zero width and nothing is drawn (tested on Unity 6000.6.6f1, com.unity.ugui 2.6.0). Project fonts are
        // single-weight files (ui-spec: a real bold weight is another font), so every glyph is asked for as Regular: plain text
        // through TMPFont.fontWeight, bold text by resetting the weight TMPFont.SetFormat chose. Bold keeps FontStyles.Bold, so
        // FairyGUI still draws it bold with the shader (faux bold, wider spacing and padding). The FairyGUI files are not changed.
        sealed class ProjectTMPFont : TMPFont
        {
            // TMPFont has no setter for the bold weight. The field is part of the FairyGUI copy in this package
            // (tests/unit/unity/tmp-setup.test.mjs checks it); if it is missing, registering a font throws instead of drawing nothing.
            static readonly FieldInfo QueryWeight = typeof(TMPFont).GetField("_fontWeight", BindingFlags.NonPublic | BindingFlags.Instance);

            public ProjectTMPFont()
            {
                if (QueryWeight == null || QueryWeight.FieldType != typeof(FontWeight))
                    throw new MissingFieldException("FairyGUI.TMPFont._fontWeight (FontWeight) not found: the FairyGUI copy in the LGUI package was changed, project fonts cannot ask TMP for Regular glyphs.");
                fontWeight = FontWeight.Regular;
            }

            public override void SetFormat(TextFormat format, float fontSizeScale)
            {
                base.SetFormat(format, fontSizeScale);
                if (format.bold) QueryWeight.SetValue(this, FontWeight.Regular);
            }
        }

        /// <summary>
        /// Whether the TextMesh Pro settings asset ("TMP Settings", imported with TMP Essential Resources) is in a Resources folder.
        /// TMP_FontAsset.CreateFontAsset reads TMP_Settings and throws a NullReferenceException without it, so the TypeScript
        /// backend checks this first and reports LGUI-RT-181. Loaded directly: TMP_Settings.instance opens TMP's importer window in the Editor.
        /// </summary>
        public static bool TmpSettingsFound
        {
            get { return Resources.Load<TMP_Settings>("TMP Settings") != null; }
        }

        /// <summary>Family name of the system font used as the fallback for project fonts; empty when none of the candidates is installed.</summary>
        public static string FallbackFontName
        {
            get { FindFallback(); return _fallbackName; }
        }

        /// <summary>The system font families tried as the fallback, in order, separated by commas (for the LGUI-RT-182 message).</summary>
        public static string FallbackFontCandidates
        {
            get
            {
                var names = new List<string>();
                foreach (string[] candidate in FallbackCandidates) names.Add(candidate[0]);
                return string.Join(", ", names);
            }
        }
    }
}
