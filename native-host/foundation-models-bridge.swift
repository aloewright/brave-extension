#!/usr/bin/env swift
import Foundation
import FoundationModels

struct BridgeRequest: Codable {
    var type: String?
    var operation: String?
    var objective: String?
    var message: String?
    var compactSummary: String?
    var observation: BrowserObservation?
    var systemPrompt: String?
    var history: [BridgeChatHistoryRow]?
    var toolsJson: String?
}

struct BridgeChatHistoryRow: Codable {
    var role: String           // "user" | "assistant" | "tool"
    var content: String
    var toolName: String?
    var toolArguments: String?
    var toolCallId: String?    // tool-result rows: ulid of the assistant tool-call this answers
    var toolError: String?
}

struct BrowserObservation: Codable {
    var url: String?
    var title: String?
    var visibleText: String?
    var nodes: [BrowserNode]?
}

struct BrowserNode: Codable {
    var ref: String?
    var role: String?
    var name: String?
    var text: String?
    var selector: String?
}

struct BridgeResponse: Codable {
    var ok: Bool
    var available: Bool
    var provider: String = "foundation-models"
    var operation: String
    var reason: String?
    var error: String?
    var contextSize: Int?
    var tokenEstimate: Int?
    var plan: AgentPlan?
    var action: AgentAction?
    var compactSummary: String?
    var status: String?
    var nextStep: String?
    var reply: String?
    var chatTurn: ChatTurnResponse?
}

@Generable
struct AgentAction: Codable {
    @Guide(description: "The next browser operation.", .anyOf(["observe", "click", "type", "scroll", "wait", "navigate", "remember", "compact", "ask_user", "done"]))
    var kind: String

    @Guide(description: "Exact element ref from the observation, like el1. Do not use a CSS selector.")
    var ref: String?

    @Guide(description: "Text, URL, selector, or concise instruction needed for the action.")
    var value: String?

    @Guide(description: "Why this action is the safest next step.")
    var reason: String
}

@Generable
struct AgentPlan: Codable {
    @Guide(description: "The user's objective, rewritten in a few words.")
    var objective: String

    @Guide(description: "Current agent status.", .anyOf(["planning", "acting", "waiting_for_user", "blocked", "done"]))
    var status: String

    @Guide(description: "The next step in one concise sentence.")
    var nextStep: String

    @Guide(description: "The condition that means the task should stop.")
    var stopCondition: String

    @Guide(description: "At most three completed steps.", .maximumCount(3))
    var completedSteps: [String]

    @Guide(description: "At most three constraints, risks, or missing facts.", .maximumCount(3))
    var risks: [String]

    @Guide(description: "The single next browser action.")
    var action: AgentAction
}

@Generable
struct CompactResult: Codable {
    @Guide(description: "Ruthless summary preserving objective, page state, progress, blockers, and next action.")
    var compactSummary: String

    @Guide(description: "Current status.", .anyOf(["planning", "acting", "waiting_for_user", "blocked", "done"]))
    var status: String

    @Guide(description: "The next step in one concise sentence.")
    var nextStep: String
}

@Generable
struct ChatToolCall: Codable {
    @Guide(description: "Tool name exactly as listed in the available tools.")
    var name: String

    @Guide(description: "JSON-encoded arguments matching the tool's schema. Use {} when no args.")
    var arguments: String
}

@Generable
struct ChatTurnResponse: Codable {
    @Guide(description: "If you have everything you need to reply to the user, put your final assistant message here. Otherwise leave nil and use toolCall.")
    var final: String?

    @Guide(description: "If you need a tool, set this to call exactly one tool. Otherwise leave nil and use `final`.")
    var toolCall: ChatToolCall?
}

func trim(_ text: String?, to limit: Int) -> String {
    let value = (text ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    guard value.count > limit else { return value }
    let end = value.index(value.startIndex, offsetBy: limit)
    return String(value[..<end]) + "...[truncated]"
}

func operationName(for request: BridgeRequest) -> String {
    let raw = request.operation ?? request.type ?? "plan"
    if raw.hasPrefix("foundationModels.") {
        return String(raw.dropFirst("foundationModels.".count))
    }
    return raw
}

func observationSummary(_ observation: BrowserObservation?) -> String {
    guard let observation else { return "No browser observation provided." }
    var lines: [String] = []
    if let url = observation.url, !url.isEmpty { lines.append("URL: \(url)") }
    if let title = observation.title, !title.isEmpty { lines.append("Title: \(title)") }
    let visible = trim(observation.visibleText, to: 1200)
    if !visible.isEmpty { lines.append("Visible text: \(visible)") }

    let nodes = Array((observation.nodes ?? []).prefix(40))
    if !nodes.isEmpty {
        lines.append("Visible interactive nodes:")
        for node in nodes {
            let ref = trim(node.ref, to: 32)
            let role = trim(node.role, to: 32)
            let name = trim(node.name, to: 120)
            let text = trim(node.text, to: 120)
            let selector = trim(node.selector, to: 160)
            lines.append("- ref=\(ref) role=\(role) name=\(name) text=\(text) selector=\(selector)")
        }
    }
    return trim(lines.joined(separator: "\n"), to: 6000)
}

func bridgeUnavailable(operation: String, reason: String, error: String? = nil) -> BridgeResponse {
    BridgeResponse(
        ok: false,
        available: false,
        operation: operation,
        reason: reason,
        error: error,
        contextSize: SystemLanguageModel.default.contextSize
    )
}

func emit(_ response: BridgeResponse) {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    do {
        let data = try encoder.encode(response)
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
    } catch {
        let fallback = #"{"ok":false,"available":false,"provider":"foundation-models","operation":"unknown","error":"failed to encode bridge response"}"#
        FileHandle.standardOutput.write(Data(fallback.utf8))
        FileHandle.standardOutput.write(Data("\n".utf8))
    }
}

func availabilityReason(_ availability: SystemLanguageModel.Availability) -> String {
    switch availability {
    case .available:
        return "available"
    default:
        return String(describing: availability)
    }
}

func tokenEstimate(for text: String) async -> Int? {
    guard #available(macOS 26.4, *) else { return nil }
    do {
        return try await SystemLanguageModel.default.tokenCount(for: text)
    } catch {
        return nil
    }
}

func makePlanPrompt(request: BridgeRequest) -> String {
    let objective = trim(request.objective ?? request.message, to: 900)
    let compact = trim(request.compactSummary, to: 1200)
    return """
    Objective:
    \(objective)

    Current compact summary:
    \(compact.isEmpty ? "None." : compact)

    Current browser observation:
    \(observationSummary(request.observation))

    Produce a plan-first browser agent decision. Choose one next action only.
    Use exact element refs from the observation when clicking or typing. Do not put CSS selectors in action.ref.
    Choose ask_user for ambiguous, destructive, credential, purchase, or privacy-sensitive actions.
    Choose done only when the objective is already satisfied.
    """
}

func makeCompactPrompt(request: BridgeRequest) -> String {
    let objective = trim(request.objective ?? request.message, to: 900)
    return """
    Objective:
    \(objective)

    Existing compact summary:
    \(trim(request.compactSummary, to: 2000))

    Current browser observation:
    \(observationSummary(request.observation))

    Compact ruthlessly. Preserve only objective, current status, page state, completed steps, blockers, user constraints, and exact next step.
    """
}

func makeChatPrompt(request: BridgeRequest) -> String {
    var lines: [String] = []
    if let sys = request.systemPrompt, !sys.isEmpty {
        lines.append(sys)
    }
    if let tools = request.toolsJson, !tools.isEmpty {
        lines.append("TOOL SCHEMAS (JSON):\n\(tools)")
    }
    if let history = request.history, !history.isEmpty {
        lines.append("CONVERSATION HISTORY:")
        for row in history {
            let label = row.role.uppercased()
            if row.role == "assistant", let name = row.toolName {
                let args = row.toolArguments ?? "{}"
                lines.append("\(label) (tool call: \(name) args=\(args))")
            } else if row.role == "tool" {
                if let err = row.toolError {
                    lines.append("\(label) (error): \(err)")
                } else {
                    lines.append("\(label) result: \(row.content)")
                }
            } else {
                lines.append("\(label): \(row.content)")
            }
        }
    }
    lines.append("Respond with one JSON matching ChatTurnResponse — either `final` (a user-facing assistant message) or `toolCall` (name + JSON arguments). Use `toolCall` only when you need a tool to answer.")
    return lines.joined(separator: "\n\n")
}

func planResponse(for request: BridgeRequest, operation: String) async throws -> BridgeResponse {
    let instructions = """
    You are a local, privacy-preserving browser agent planner running on the user's Mac.
    You do not execute browser actions. You produce compact structured plans for a consent-gated browser tool layer.
    Keep output short. Do not invent page details that are not in the observation.
    """
    let prompt = makePlanPrompt(request: request)
    let session = LanguageModelSession(instructions: instructions)
    let options = GenerationOptions(sampling: .greedy, maximumResponseTokens: 384)
    let response = try await session.respond(to: prompt, generating: AgentPlan.self, options: options)
    let plan = response.content
    return BridgeResponse(
        ok: true,
        available: true,
        operation: operation,
        contextSize: SystemLanguageModel.default.contextSize,
        tokenEstimate: await tokenEstimate(for: prompt),
        plan: plan,
        action: plan.action,
        status: plan.status,
        nextStep: plan.nextStep,
        reply: [
            "Objective: \(plan.objective)",
            "Status: \(plan.status)",
            "Next step: \(plan.nextStep)",
            "Action: \(plan.action.kind) - \(plan.action.reason)"
        ].joined(separator: "\n")
    )
}

func compactResponse(for request: BridgeRequest, operation: String) async throws -> BridgeResponse {
    let instructions = """
    You are a local browser-agent session compactor.
    Preserve task-critical state and delete incidental detail.
    """
    let prompt = makeCompactPrompt(request: request)
    let session = LanguageModelSession(instructions: instructions)
    let options = GenerationOptions(sampling: .greedy, maximumResponseTokens: 320)
    let response = try await session.respond(to: prompt, generating: CompactResult.self, options: options)
    let compact = response.content
    return BridgeResponse(
        ok: true,
        available: true,
        operation: operation,
        contextSize: SystemLanguageModel.default.contextSize,
        tokenEstimate: await tokenEstimate(for: prompt),
        compactSummary: compact.compactSummary,
        status: compact.status,
        nextStep: compact.nextStep,
        reply: compact.compactSummary
    )
}

let data = FileHandle.standardInput.readDataToEndOfFile()
let request: BridgeRequest
do {
    request = try JSONDecoder().decode(BridgeRequest.self, from: data)
} catch {
    emit(bridgeUnavailable(operation: "unknown", reason: "invalid request", error: error.localizedDescription))
    exit(0)
}

let operation = operationName(for: request)
let availability = SystemLanguageModel.default.availability
guard case .available = availability else {
    emit(bridgeUnavailable(operation: operation, reason: availabilityReason(availability)))
    exit(0)
}

if operation == "status" {
    emit(BridgeResponse(
        ok: true,
        available: true,
        operation: operation,
        reason: "available",
        contextSize: SystemLanguageModel.default.contextSize
    ))
    exit(0)
}

do {
    switch operation {
    case "compact":
        emit(try await compactResponse(for: request, operation: operation))
    case "nextAction", "plan":
        emit(try await planResponse(for: request, operation: operation))
    case "chat":
        let prompt = makeChatPrompt(request: request)
        let session = LanguageModelSession()
        let response = try await session.respond(
            to: prompt,
            generating: ChatTurnResponse.self
        )
        var out = BridgeResponse(
            ok: true,
            available: true,
            operation: "chat",
            contextSize: SystemLanguageModel.default.contextSize
        )
        out.chatTurn = response.content
        emit(out)
    default:
        emit(bridgeUnavailable(operation: operation, reason: "unsupported operation"))
    }
} catch {
    emit(bridgeUnavailable(operation: operation, reason: "generation failed", error: String(describing: error)))
}
