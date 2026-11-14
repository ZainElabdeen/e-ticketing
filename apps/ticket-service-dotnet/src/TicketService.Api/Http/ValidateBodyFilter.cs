using FluentValidation;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.AspNetCore.Mvc.ModelBinding;

namespace TicketService.Api.Http;

/// <summary>
/// Runs the registered FluentValidation validator for every bound request body and throws
/// <see cref="RequestValidationException"/> on failure. A JSON <c>null</c> body validates as an empty
/// request, so the validator (not the binder) rejects it with the same envelope.
/// </summary>
public sealed class ValidateBodyFilter : IAsyncActionFilter
{
    public async Task OnActionExecutionAsync(ActionExecutingContext context, ActionExecutionDelegate next)
    {
        foreach (var parameter in context.ActionDescriptor.Parameters.OfType<ControllerParameterDescriptor>())
        {
            if (parameter.BindingInfo?.BindingSource != BindingSource.Body)
            {
                continue;
            }
            var type = parameter.ParameterType;
            if (context.HttpContext.RequestServices.GetService(typeof(IValidator<>).MakeGenericType(type)) is not IValidator validator)
            {
                continue;
            }
            if (!context.ActionArguments.TryGetValue(parameter.Name, out var argument) || argument is null)
            {
                argument = Activator.CreateInstance(type)!;
                context.ActionArguments[parameter.Name] = argument;
            }
            var result = await validator.ValidateAsync(new ValidationContext<object>(argument), context.HttpContext.RequestAborted);
            if (!result.IsValid)
            {
                throw new RequestValidationException(string.Join("; ", result.Errors.Select(e => e.ErrorMessage).Distinct()));
            }
        }
        await next();
    }
}
