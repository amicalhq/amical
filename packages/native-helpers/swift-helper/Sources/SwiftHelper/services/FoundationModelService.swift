import Foundation

#if canImport(FoundationModels)
import FoundationModels
#endif

class FoundationModelService {

    func checkAvailability() -> CheckFoundationModelAvailabilityResultSchema {
        #if canImport(FoundationModels)
        if #available(macOS 26, *) {
            let model = SystemLanguageModel.default
            switch model.availability {
            case .available:
                return CheckFoundationModelAvailabilityResultSchema(available: true, reason: nil)
            case .unavailable(let reason):
                return CheckFoundationModelAvailabilityResultSchema(available: false, reason: String(describing: reason))
            @unknown default:
                return CheckFoundationModelAvailabilityResultSchema(available: false, reason: "unknown")
            }
        }
        #endif
        return CheckFoundationModelAvailabilityResultSchema(available: false, reason: "deviceNotEligible")
    }

    func generate(params: GenerateWithFoundationModelParamsSchema) async throws -> GenerateWithFoundationModelResultSchema {
        #if canImport(FoundationModels)
        if #available(macOS 26, *) {
            let instructions = params.systemPrompt
            let session = LanguageModelSession(instructions: instructions)
            var options = GenerationOptions()
            if let temperature = params.temperature {
                options.temperature = temperature
            }
            if let maxTokens = params.maxTokens {
                options.maximumResponseTokens = maxTokens
            }
            let response = try await session.respond(to: params.userPrompt, options: options)
            return GenerateWithFoundationModelResultSchema(content: response.content)
        }
        #endif
        throw NSError(domain: "FoundationModelService", code: -1,
                      userInfo: [NSLocalizedDescriptionKey: "Foundation Models not available on this device"])
    }
}
