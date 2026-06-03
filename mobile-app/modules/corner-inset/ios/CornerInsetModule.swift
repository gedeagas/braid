import ExpoModulesCore
import UIKit

// Native bridge for iPadOS 26's "Corner Adaptation Margin" - the region the
// system reserves in a window's top-leading corner for the window controls
// ("traffic lights") when the app runs in a resizable window. This is a
// distinct LayoutRegion from the classic safe area, so the standard safe-area
// insets do NOT account for it; we read it explicitly here and report it to JS
// so the header's leading content (back button) can dodge the controls.
//
// On any OS older than iPadOS 26 the region doesn't exist and we report zeros,
// so the JS primitive renders a 0-width spacer and nothing shifts.
public class CornerInsetModule: Module {
  public func definition() -> ModuleDefinition {
    // Must match the name passed to `requireNativeView` on the JS side.
    Name("CornerInset")

    View(CornerInsetView.self) {
      Events("onInsetsChange")
    }
  }
}

// An invisible, non-interactive measuring view. It reports the corner-margin
// insets of its *window* (not of itself): the window's frame is stable and
// independent of this view's own width, so sizing the spacer from the reported
// value can never feed back into the measurement (no relayout ping-pong).
class CornerInsetView: ExpoView {
  let onInsetsChange = EventDispatcher()

  // The window we've attached a bounds observer to (resizes in iPadOS 26
  // windowing change the corner margin without necessarily relaying out this
  // small spacer, so we observe the window directly rather than relying on our
  // own layoutSubviews alone).
  private weak var observedWindow: UIWindow?
  private var lastLeading: CGFloat = -1
  private var lastTrailing: CGFloat = -1
  private var lastTop: CGFloat = -1

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    isUserInteractionEnabled = false
    isHidden = false // 0-width but present, so it lays out and reports.
  }

  override func didMoveToWindow() {
    super.didMoveToWindow()
    if observedWindow !== window {
      observedWindow?.removeObserver(self, forKeyPath: "bounds")
      observedWindow = window
      observedWindow?.addObserver(self, forKeyPath: "bounds", options: [.new], context: nil)
    }
    emitInsets(force: true)
  }

  override func observeValue(
    forKeyPath keyPath: String?,
    of object: Any?,
    change: [NSKeyValueChangeKey: Any]?,
    context: UnsafeMutableRawPointer?
  ) {
    if keyPath == "bounds" {
      emitInsets(force: false)
    }
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    emitInsets(force: false)
  }

  override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
    super.traitCollectionDidChange(previousTraitCollection)
    emitInsets(force: false)
  }

  private func emitInsets(force: Bool) {
    var leading: CGFloat = 0
    var trailing: CGFloat = 0
    var top: CGFloat = 0

    // iPadOS 26 exposes the window-control region as the SAFE AREA layout region
    // adapted for the corner (UIViewLayoutRegion). `.horizontal` adaptation
    // pushes a header's leading content inward (not down) to clear the controls,
    // which is what a back button in a top bar wants.
    //
    // The corner-adapted region is the NORMAL safe area PLUS whatever margin the
    // window controls reserve - so on an iPhone (no controls) or a full-screen
    // iPad it equals the plain safe area, which is already applied by the JS
    // header's SafeAreaView. Reporting the raw value there double-counts the
    // device safe area (stray padding before the back button, worst on notched
    // iPhones / landscape). We report only the DELTA over the window's existing
    // safe area, so it's exactly 0 unless the controls are actually present.
    if #available(iOS 26.0, *), let win = window {
      let region = UIView.LayoutRegion.safeArea(cornerAdaptation: .horizontal)
      let adapted = win.directionalEdgeInsets(for: region)
      let base = win.safeAreaInsets
      let isRTL = effectiveUserInterfaceLayoutDirection == .rightToLeft
      let baseLeading = isRTL ? base.right : base.left
      let baseTrailing = isRTL ? base.left : base.right
      leading = max(0, adapted.leading - baseLeading)
      trailing = max(0, adapted.trailing - baseTrailing)
      top = max(0, adapted.top - base.top)
    }

    // Values are already in points (what React Native lays out in); no scaling.
    if !force && leading == lastLeading && trailing == lastTrailing && top == lastTop {
      return
    }
    lastLeading = leading
    lastTrailing = trailing
    lastTop = top
    onInsetsChange([
      "leading": leading,
      "trailing": trailing,
      "top": top,
    ])
  }

  deinit {
    observedWindow?.removeObserver(self, forKeyPath: "bounds")
  }
}
