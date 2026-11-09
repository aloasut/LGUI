using System;
using System.Reflection;
using FairyGUI;

namespace LGUI
{
    public static partial class Platform
    {
        // 代码补间（mvc/tween）要知道的事：FairyGUI-unity 不公开齿轮、按钮的按下效果和动效的每一项，这里只读出来（不改 FairyGUI 源码）。
        // GObject.GetGear 会顺手建一个齿轮，所以直接读 _gears。只在补间开始、挂载组件时调用，不在每帧调用。
        // 出错一律报 LGUI-RT-286（补间读不到 FairyGUI 的内部字段），写明是哪个字段、期望什么类型；读到的类型对不上也报，不静默当成「没有」。
        const BindingFlags Private = BindingFlags.Instance | BindingFlags.NonPublic;
        static readonly FieldInfo gearsField = typeof(GObject).GetField("_gears", Private);
        static readonly FieldInfo downEffectField = typeof(GButton).GetField("_downEffect", Private);
        static readonly FieldInfo downEffectValueField = typeof(GButton).GetField("_downEffectValue", Private);
        static readonly FieldInfo transitionOwnerField = typeof(Transition).GetField("_owner", Private);
        static readonly FieldInfo transitionItemsField = typeof(Transition).GetField("_items", Private);
        static readonly MethodInfo childByIdMethod = typeof(GComponent).GetMethod("GetChildById", Private);

        static Exception TweenFailure(string message)
        {
            return new InvalidOperationException("LGUI-RT-286  代码补间读不到 FairyGUI-unity 的内部信息：" + message + " → 使用随 LGUI 分发的 FairyGUI-unity（plugin/framework/backends/unity/package/FairyGUI）；升级过 FairyGUI 的，对照 TweenInfo.cs 改字段名和类型。");
        }

        static T Read<T>(FieldInfo field, object owner, string name)
        {
            if (owner == null) throw TweenFailure("读 " + name + " 时对象为空。");
            if (field == null) throw TweenFailure("没有字段 " + name + "。");
            var value = field.GetValue(owner);
            if (value is T typed) return typed;
            throw TweenFailure(name + " 的类型是 " + (value == null ? "null" : value.GetType().FullName) + "，期望 " + typeof(T).FullName + "。");
        }

        /// <summary>第 index 个齿轮（1 XY、2 Size、3 Look、4 Color、6 Text、9 FontSize）跟的控制器名；没有这个齿轮是空字符串。</summary>
        public static string GearController(GObject obj, int index)
        {
            var gears = Read<GearBase[]>(gearsField, obj, "GObject._gears");
            if (index < 0 || index >= gears.Length) throw TweenFailure("齿轮序号 " + index + " 超出 GObject._gears 的长度 " + gears.Length + "。");
            var gear = gears[index];
            return gear == null || gear.controller == null ? "" : gear.controller.name;
        }

        /// <summary>按钮的按下效果：0 没有、1 变暗、2 缩放。</summary>
        public static int ButtonDownEffect(GButton button) { return Read<int>(downEffectField, button, "GButton._downEffect"); }

        /// <summary>按钮的 downEffectValue（按下时的缩放或亮度）。</summary>
        public static float ButtonDownEffectValue(GButton button) { return Read<float>(downEffectValueField, button, "GButton._downEffectValue"); }

        /// <summary>关掉 FairyGUI 自己的按下缩放（框架接管 downEffect="scale"，按下、松开带缓动）。</summary>
        public static void DisableButtonDownEffect(GButton button)
        {
            Read<int>(downEffectField, button, "GButton._downEffect");
            downEffectField.SetValue(button, 0);
        }

        static Array TransitionItems(Transition transition)
        {
            // 动效没有项时 FairyGUI 的 _items 也是数组（长度 0），读到 null 说明字段对不上。
            return Read<Array>(transitionItemsField, transition, "Transition._items");
        }

        static object ItemField(object item, string name)
        {
            if (item == null) throw TweenFailure("Transition._items 里有空项。");
            var field = item.GetType().GetField(name, BindingFlags.Instance | BindingFlags.Public);
            if (field == null) throw TweenFailure("没有字段 TransitionItem." + name + "。");
            return field.GetValue(item);
        }

        static object ItemAt(Transition transition, int index)
        {
            var items = TransitionItems(transition);
            if (index < 0 || index >= items.Length) throw TweenFailure("动效项序号 " + index + " 超出 Transition._items 的长度 " + items.Length + "。");
            return items.GetValue(index);
        }

        /// <summary>动效有几项。</summary>
        public static int TransitionItemCount(Transition transition) { return TransitionItems(transition).Length; }

        /// <summary>第 index 项的类型（TransitionActionType：0 XY、1 Size、2 Scale、4 Alpha、5 Rotation、6 Color、11 Shake、14 Text……）。</summary>
        public static int TransitionItemType(Transition transition, int index)
        {
            var type = ItemField(ItemAt(transition, index), "type");
            if (type is TransitionActionType action) return (int)action;
            throw TweenFailure("TransitionItem.type 的类型是 " + (type == null ? "null" : type.GetType().FullName) + "，期望 TransitionActionType。");
        }

        /// <summary>第 index 项改的控件：和 FairyGUI 放动效时一样，没写目标是组件自己；目标不在了是 null。</summary>
        public static GObject TransitionItemTarget(Transition transition, int index)
        {
            var item = ItemAt(transition, index);
            var target = ItemField(item, "target");
            if (target != null && !(target is GObject)) throw TweenFailure("TransitionItem.target 的类型是 " + target.GetType().FullName + "，期望 GObject。");
            if (target != null) return (GObject)target;
            var owner = Read<GComponent>(transitionOwnerField, transition, "Transition._owner");
            if (childByIdMethod == null) throw TweenFailure("没有方法 GComponent.GetChildById。");
            var id = ItemField(item, "targetId");
            if (id != null && !(id is string)) throw TweenFailure("TransitionItem.targetId 的类型是 " + id.GetType().FullName + "，期望 string。");
            return string.IsNullOrEmpty((string)id) ? owner : childByIdMethod.Invoke(owner, new object[] { id }) as GObject;
        }
    }
}
